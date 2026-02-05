import pool from './db.js';
import llmClient from './Llm-client.js';

class WorkflowExecutor {
  constructor(websocketServer) {
    this.ws = websocketServer;
  }

  // Broadcast execution updates to connected clients
  broadcast(executionId, update) {
    if (this.ws) {
      this.ws.broadcast(JSON.stringify({
        type: 'execution_update',
        executionId,
        ...update
      }));
    }
  }

  // Execute a complete workflow
  async executeWorkflow(workflowId) {
    console.log(`[Executor] Starting workflow ${workflowId} (Trace ID: ${Date.now()})`);

    const client = await pool.connect();
    let executionId;

    try {
      await client.query('BEGIN');

      // Create execution record
      const execResult = await client.query(
        `INSERT INTO workflow_executions (workflow_id, status) 
         VALUES ($1, $2) 
         RETURNING id`,
        [workflowId, 'running']
      );
      executionId = execResult.rows[0].id;

      // Get all workflow steps in order
      const stepsResult = await client.query(
        `SELECT * FROM workflow_steps 
         WHERE workflow_id = $1 
         ORDER BY step_order ASC`,
        [workflowId]
      );

      await client.query('COMMIT');

      const steps = stepsResult.rows;
      console.log(`[Executor] Found ${steps.length} steps to execute`);

      // Broadcast initial status
      this.broadcast(executionId, {
        status: 'running',
        currentStep: 0,
        totalSteps: steps.length
      });

      // Execute steps sequentially
      let previousOutput = null;

      for (let i = 0; i < steps.length; i++) {
        const step = steps[i];
        console.log(`[Executor] Executing step ${i + 1}/${steps.length}: ${step.name}`);

        this.broadcast(executionId, {
          status: 'running',
          currentStep: i + 1,
          totalSteps: steps.length,
          stepName: step.name
        });

        try {
          const stepResult = await this.executeStep(
            executionId,
            step,
            previousOutput
          );

          if (stepResult.status === 'failed') {
            // Step failed after retries
            await this.markExecutionFailed(
              executionId,
              `Step ${step.step_order} (${step.name}) failed: ${stepResult.error}`
            );

            this.broadcast(executionId, {
              status: 'failed',
              error: stepResult.error,
              failedStep: i + 1
            });

            return {
              executionId,
              status: 'failed',
              error: stepResult.error
            };
          }

          // Step succeeded, use its output for next step
          previousOutput = stepResult.output;

        } catch (error) {
          console.error(`[Executor] Error executing step ${step.name}:`, error);
          await this.markExecutionFailed(executionId, error.message);

          this.broadcast(executionId, {
            status: 'failed',
            error: error.message,
            failedStep: i + 1
          });

          return {
            executionId,
            status: 'failed',
            error: error.message
          };
        }
      }

      // All steps completed successfully
      await this.markExecutionCompleted(executionId);

      this.broadcast(executionId, {
        status: 'completed',
        currentStep: steps.length,
        totalSteps: steps.length
      });

      console.log(`[Executor] Workflow ${workflowId} completed successfully`);
      return {
        executionId,
        status: 'completed'
      };

    } catch (error) {
      await client.query('ROLLBACK');
      console.error('[Executor] Error executing workflow:', error);
      throw error;
    } finally {
      client.release();
    }
  }

  // Execute a single step with retry logic
  async executeStep(executionId, step, previousOutput) {
    const maxRetries = step.max_retries || 2;
    let retryCount = 0;

    while (retryCount <= maxRetries) {
      console.log(`[Executor] Step ${step.name} - Attempt ${retryCount + 1}/${maxRetries + 1}`);

      const client = await pool.connect();
      let stepExecutionId;

      try {
        await client.query('BEGIN');

        // Create step execution record
        const stepExecResult = await client.query(
          `INSERT INTO step_executions (
            execution_id, step_id, step_order, status, retry_count
          ) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
          [executionId, step.id, step.step_order, 'running', retryCount]
        );
        stepExecutionId = stepExecResult.rows[0].id;

        await client.query('COMMIT');

        // Build prompt with context from previous step
        const fullPrompt = this.buildPrompt(step, previousOutput);

        // Update step execution with prompt
        await pool.query(
          `UPDATE step_executions SET prompt_sent = $1 WHERE id = $2`,
          [fullPrompt, stepExecutionId]
        );

        this.broadcast(executionId, {
          stepUpdate: {
            stepExecutionId,
            status: 'calling_llm',
            stepName: step.name
          }
        });

        // Call LLM
        const executeResult = await llmClient.callModel(step.model, fullPrompt);
        const llmResponse = executeResult.content;

        if (executeResult.switched) {
          // Persist the model change so future runs use the correct model
          console.log(`[Executor] Persisting model switch for step ${step.id} to ${executeResult.usedModel}`);
          await pool.query(
            `UPDATE workflow_steps SET model = $1 WHERE id = $2`,
            [executeResult.usedModel, step.id]
          );

          this.broadcast(executionId, {
            type: 'model_switched',
            originalModel: step.model,
            newModel: executeResult.usedModel,
            stepName: step.name
          });
        }

        // Update with LLM response
        await pool.query(
          `UPDATE step_executions SET llm_response = $1 WHERE id = $2`,
          [llmResponse, stepExecutionId]
        );

        this.broadcast(executionId, {
          stepUpdate: {
            stepExecutionId,
            status: 'evaluating_criteria',
            stepExecutionId,
            status: 'evaluating_criteria',
            response: 'Generating...', // Placeholder
            // llmResponse removed to prevent WebSocket disconnects on large payloads
          }
        });

        // Evaluate completion criteria
        const criteria = step.completion_criteria;
        const criteriaResult = await llmClient.evaluateCriteria(llmResponse, criteria);

        // Update with criteria result
        await pool.query(
          `UPDATE step_executions 
           SET criteria_result = $1, status = $2, completed_at = NOW() 
           WHERE id = $3`,
          [JSON.stringify(criteriaResult), criteriaResult.passed ? 'completed' : 'failed', stepExecutionId]
        );

        if (criteriaResult.passed) {
          console.log(`[Executor] Step ${step.name} - Criteria passed`);

          this.broadcast(executionId, {
            stepUpdate: {
              stepExecutionId,
              status: 'completed',
              criteriaResult
            }
          });

          return {
            status: 'completed',
            output: llmResponse,
            stepExecutionId
          };
        } else {
          console.log(`[Executor] Step ${step.name} - Criteria failed: ${criteriaResult.reason}`);

          this.broadcast(executionId, {
            stepUpdate: {
              stepExecutionId,
              status: 'retry',
              criteriaResult,
              retryCount: retryCount + 1
            }
          });

          retryCount++;

          if (retryCount > maxRetries) {
            return {
              status: 'failed',
              error: `Criteria not met after ${maxRetries + 1} attempts: ${criteriaResult.reason}`,
              stepExecutionId
            };
          }

          // Wait before retry
          await new Promise(resolve => setTimeout(resolve, 2000));
        }

      } catch (error) {
        await client.query('ROLLBACK');
        console.error(`[Executor] Error in step execution:`, error);

        if (stepExecutionId) {
          await pool.query(
            `UPDATE step_executions 
             SET status = $1, error_message = $2, completed_at = NOW() 
             WHERE id = $3`,
            ['failed', error.message, stepExecutionId]
          );
        }

        retryCount++;

        if (retryCount > maxRetries) {
          return {
            status: 'failed',
            error: error.message,
            stepExecutionId
          };
        }

      } finally {
        client.release();
      }
    }
  }

  // Build prompt with context from previous step
  buildPrompt(step, previousOutput) {
    console.log(`[Executor] Building prompt for step ${step.name}`);
    console.log(`[Executor] Previous output available: ${previousOutput ? 'YES' : 'NO'} (${previousOutput ? previousOutput.length : 0} chars)`);

    let prompt = step.prompt;

    if (previousOutput) {
      const contextStrategy = step.context_strategy || 'full';
      let context = '';

      switch (contextStrategy) {
        case 'full':
          context = previousOutput;
          break;
        case 'summary':
          // Take first 500 chars as summary
          context = previousOutput.substring(0, 500) + (previousOutput.length > 500 ? '...' : '');
          break;
        case 'code_only':
          // Extract code blocks
          const codeMatch = previousOutput.match(/```[\s\S]*?```/g);
          context = codeMatch ? codeMatch.join('\n\n') : previousOutput;
          break;
        default:
          context = previousOutput;
      }

      prompt = `Context from previous step:\n${context}\n\n${prompt}`;
    }

    return prompt;
  }

  async markExecutionCompleted(executionId) {
    await pool.query(
      `UPDATE workflow_executions 
       SET status = $1, completed_at = NOW() 
       WHERE id = $2`,
      ['completed', executionId]
    );
  }

  async markExecutionFailed(executionId, errorMessage) {
    await pool.query(
      `UPDATE workflow_executions 
       SET status = $1, error_message = $2, completed_at = NOW() 
       WHERE id = $3`,
      ['failed', errorMessage, executionId]
    );
  }
}

export default WorkflowExecutor;