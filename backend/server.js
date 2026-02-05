import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import pool from './db.js';
import createTables from './schema.js';
import WorkflowWebSocket from './websocket.js';
import WorkflowExecutor from './executor.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;
const WS_PORT = process.env.WS_PORT || 5001;

// Middleware
app.use(cors());
app.use(express.json());

// Initialize database on startup
await createTables();

// Initialize WebSocket server for real-time updates
const wsServer = new WorkflowWebSocket(WS_PORT);

// Initialize workflow executor
const executor = new WorkflowExecutor(wsServer);

// ============================================================================
// WORKFLOW ROUTES
// ============================================================================

// Get all workflows
app.get('/api/workflows', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT w.*, 
        COUNT(DISTINCT ws.id) as step_count,
        COUNT(DISTINCT we.id) as execution_count
      FROM workflows w
      LEFT JOIN workflow_steps ws ON w.id = ws.workflow_id
      LEFT JOIN workflow_executions we ON w.id = we.workflow_id
      GROUP BY w.id
      ORDER BY w.updated_at DESC
    `);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching workflows:', error);
    res.status(500).json({ error: 'Failed to fetch workflows' });
  }
});

// Get single workflow with steps
app.get('/api/workflows/:id', async (req, res) => {
  const { id } = req.params;

  try {
    const workflowResult = await pool.query(
      'SELECT * FROM workflows WHERE id = $1',
      [id]
    );

    if (workflowResult.rows.length === 0) {
      return res.status(404).json({ error: 'Workflow not found' });
    }

    const stepsResult = await pool.query(
      'SELECT * FROM workflow_steps WHERE workflow_id = $1 ORDER BY step_order ASC',
      [id]
    );

    res.json({
      ...workflowResult.rows[0],
      steps: stepsResult.rows
    });
  } catch (error) {
    console.error('Error fetching workflow:', error);
    res.status(500).json({ error: 'Failed to fetch workflow' });
  }
});

// Create workflow
app.post('/api/workflows', async (req, res) => {
  const { name, description } = req.body;

  if (!name) {
    return res.status(400).json({ error: 'Workflow name required' });
  }

  try {
    const result = await pool.query(
      `INSERT INTO workflows (name, description) 
       VALUES ($1, $2) 
       RETURNING *`,
      [name, description || null]
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error creating workflow:', error);
    res.status(500).json({ error: 'Failed to create workflow' });
  }
});

// Update workflow
app.put('/api/workflows/:id', async (req, res) => {
  const { id } = req.params;
  const { name, description } = req.body;

  try {
    const result = await pool.query(
      `UPDATE workflows 
       SET name = $1, description = $2, updated_at = NOW() 
       WHERE id = $3 
       RETURNING *`,
      [name, description, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Workflow not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error updating workflow:', error);
    res.status(500).json({ error: 'Failed to update workflow' });
  }
});

// Delete workflow
app.delete('/api/workflows/:id', async (req, res) => {
  const { id } = req.params;

  try {
    const result = await pool.query(
      'DELETE FROM workflows WHERE id = $1 RETURNING id',
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Workflow not found' });
    }

    res.json({ message: 'Workflow deleted successfully' });
  } catch (error) {
    console.error('Error deleting workflow:', error);
    res.status(500).json({ error: 'Failed to delete workflow' });
  }
});

// ============================================================================
// WORKFLOW STEP ROUTES
// ============================================================================

// Add step to workflow
app.post('/api/workflows/:id/steps', async (req, res) => {
  const { id } = req.params;
  const { name, model, prompt, completion_criteria, context_strategy, max_retries } = req.body;

  if (!name || !model || !prompt || !completion_criteria) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Get next step order
    const orderResult = await client.query(
      'SELECT COALESCE(MAX(step_order), 0) + 1 as next_order FROM workflow_steps WHERE workflow_id = $1',
      [id]
    );
    const stepOrder = orderResult.rows[0].next_order;

    const result = await client.query(
      `INSERT INTO workflow_steps (
        workflow_id, step_order, name, model, prompt, 
        completion_criteria, context_strategy, max_retries
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [id, stepOrder, name, model, prompt, JSON.stringify(completion_criteria),
        context_strategy || 'full', max_retries || 2]
    );

    // Update workflow timestamp
    await client.query(
      'UPDATE workflows SET updated_at = NOW() WHERE id = $1',
      [id]
    );

    await client.query('COMMIT');
    res.status(201).json(result.rows[0]);
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error adding step:', error);
    res.status(500).json({ error: 'Failed to add step' });
  } finally {
    client.release();
  }
});

// Update step
app.put('/api/steps/:id', async (req, res) => {
  const { id } = req.params;
  const { name, model, prompt, completion_criteria, context_strategy, max_retries } = req.body;

  try {
    const result = await pool.query(
      `UPDATE workflow_steps 
       SET name = $1, model = $2, prompt = $3, 
           completion_criteria = $4, context_strategy = $5, max_retries = $6
       WHERE id = $7 
       RETURNING *`,
      [name, model, prompt, JSON.stringify(completion_criteria),
        context_strategy, max_retries, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Step not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error updating step:', error);
    res.status(500).json({ error: 'Failed to update step' });
  }
});

// Delete step
app.delete('/api/steps/:id', async (req, res) => {
  const { id } = req.params;

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Get workflow_id and step_order before deleting
    const stepResult = await client.query(
      'SELECT workflow_id, step_order FROM workflow_steps WHERE id = $1',
      [id]
    );

    if (stepResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Step not found' });
    }

    const { workflow_id, step_order } = stepResult.rows[0];

    // Delete step
    await client.query('DELETE FROM workflow_steps WHERE id = $1', [id]);

    // Reorder remaining steps
    await client.query(
      `UPDATE workflow_steps 
       SET step_order = step_order - 1 
       WHERE workflow_id = $1 AND step_order > $2`,
      [workflow_id, step_order]
    );

    await client.query('COMMIT');
    res.json({ message: 'Step deleted successfully' });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error deleting step:', error);
    res.status(500).json({ error: 'Failed to delete step' });
  } finally {
    client.release();
  }
});

// Reorder steps
app.put('/api/workflows/:id/steps/reorder', async (req, res) => {
  const { id } = req.params;
  const { stepIds } = req.body; // Array of step IDs in new order

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    for (let i = 0; i < stepIds.length; i++) {
      await client.query(
        'UPDATE workflow_steps SET step_order = $1 WHERE id = $2 AND workflow_id = $3',
        [i + 1, stepIds[i], id]
      );
    }

    await client.query('COMMIT');
    res.json({ message: 'Steps reordered successfully' });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error reordering steps:', error);
    res.status(500).json({ error: 'Failed to reorder steps' });
  } finally {
    client.release();
  }
});

// ============================================================================
// WORKFLOW EXECUTION ROUTES
// ============================================================================

// Execute workflow
app.post('/api/workflows/:id/execute', async (req, res) => {
  const { id } = req.params;

  try {
    console.log(`[API] Received execution request for workflow ${id}`);
    // Start execution asynchronously
    executor.executeWorkflow(parseInt(id))
      .then(result => {
        console.log(`Workflow ${id} execution completed:`, result);
      })
      .catch(error => {
        console.error(`Workflow ${id} execution failed:`, error);
      });

    // Immediately return acknowledgment
    res.json({
      message: 'Workflow execution started',
      status: 'running'
    });
  } catch (error) {
    console.error('Error starting workflow execution:', error);
    res.status(500).json({ error: 'Failed to start workflow execution' });
  }
});

// Get workflow execution history
app.get('/api/workflows/:id/executions', async (req, res) => {
  const { id } = req.params;

  try {
    const result = await pool.query(
      `SELECT * FROM workflow_executions 
       WHERE workflow_id = $1 
       ORDER BY started_at DESC 
       LIMIT 50`,
      [id]
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching executions:', error);
    res.status(500).json({ error: 'Failed to fetch executions' });
  }
});

// Get execution details with step executions
app.get('/api/executions/:id', async (req, res) => {
  const { id } = req.params;

  try {
    const executionResult = await pool.query(
      'SELECT * FROM workflow_executions WHERE id = $1',
      [id]
    );

    if (executionResult.rows.length === 0) {
      return res.status(404).json({ error: 'Execution not found' });
    }

    const stepsResult = await pool.query(
      `SELECT se.*, ws.name as step_name, ws.model
       FROM step_executions se
       JOIN workflow_steps ws ON se.step_id = ws.id
       WHERE se.execution_id = $1
       ORDER BY se.step_order ASC`,
      [id]
    );

    res.json({
      ...executionResult.rows[0],
      steps: stepsResult.rows
    });
  } catch (error) {
    console.error('Error fetching execution:', error);
    res.status(500).json({ error: 'Failed to fetch execution' });
  }
});

// ============================================================================
// UTILITY ROUTES
// ============================================================================

// Get available models
app.get('/api/models', (req, res) => {
  res.json([
    { id: 'fireworks-ai/kimi-k2p5', name: 'Kimi k2p5', provider: 'Fireworks AI', cost: 'low', description: 'Recommended - Variable Speed and Performance' },
    { id: 'fireworks-ai/kimi-k2-instruct-0905', name: 'Kimi k2 Instruct', provider: 'Fireworks AI', cost: 'low', description: 'Instruction tuned model' },
    { id: 'gpt-4o', name: 'GPT-4o', provider: 'OpenAI', cost: 'high', description: 'Most capable model' },
    { id: 'gpt-4o-mini', name: 'GPT-4o Mini', provider: 'OpenAI', cost: 'low', description: 'Fast and affordable' },
    { id: 'gpt-4-turbo', name: 'GPT-4 Turbo', provider: 'OpenAI', cost: 'high', description: 'High performance' },
    { id: 'gpt-3.5-turbo', name: 'GPT-3.5 Turbo', provider: 'OpenAI', cost: 'low', description: 'Fast and efficient' },
    { id: 'claude-3-5-sonnet-20241022', name: 'Claude 3.5 Sonnet', provider: 'Anthropic', cost: 'medium', description: 'Balanced performance' },
    { id: 'claude-3-5-haiku-20241022', name: 'Claude 3.5 Haiku', provider: 'Anthropic', cost: 'low', description: 'Fast responses' },
    { id: 'gemini-2.0-flash-exp', name: 'Gemini 2.0 Flash', provider: 'Google', cost: 'low', description: 'Experimental fast model' },
  ]);
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ============================================================================
// START SERVER
// ============================================================================

const server = app.listen(PORT, () => {
  console.log(`\n🚀 Workflow Builder API running on http://localhost:${PORT} (PID: ${process.pid})`);
  console.log(`📡 WebSocket server running on ws://localhost:${WS_PORT}`);
  console.log(`   Database: ${process.env.DATABASE_URL}\n`);
});

// Graceful Shutdown
const shutdown = () => {
  console.log('Shutting down server...');
  server.close(() => {
    console.log('HTTP server closed');
  });
  if (wsServer) {
    wsServer.close();
    console.log('WebSocket server closed');
  }
  pool.end();
  process.exit(0);
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);