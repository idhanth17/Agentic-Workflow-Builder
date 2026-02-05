import pool from './db.js';

const createTables = async () => {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');

    // Workflows table - stores workflow definitions
    await client.query(`
      CREATE TABLE IF NOT EXISTS workflows (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        description TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Workflow steps - each workflow has multiple ordered steps
    await client.query(`
      CREATE TABLE IF NOT EXISTS workflow_steps (
        id SERIAL PRIMARY KEY,
        workflow_id INTEGER NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
        step_order INTEGER NOT NULL,
        name VARCHAR(255) NOT NULL,
        model VARCHAR(100) NOT NULL,
        prompt TEXT NOT NULL,
        completion_criteria JSONB NOT NULL,
        context_strategy VARCHAR(50) DEFAULT 'full',
        max_retries INTEGER DEFAULT 2,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(workflow_id, step_order)
      )
    `);

    // Workflow executions - tracks each run of a workflow
    await client.query(`
      CREATE TABLE IF NOT EXISTS workflow_executions (
        id SERIAL PRIMARY KEY,
        workflow_id INTEGER NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
        status VARCHAR(50) NOT NULL,
        started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        completed_at TIMESTAMP,
        error_message TEXT
      )
    `);

    // Step executions - tracks each step execution within a workflow run
    await client.query(`
      CREATE TABLE IF NOT EXISTS step_executions (
        id SERIAL PRIMARY KEY,
        execution_id INTEGER NOT NULL REFERENCES workflow_executions(id) ON DELETE CASCADE,
        step_id INTEGER NOT NULL REFERENCES workflow_steps(id) ON DELETE CASCADE,
        step_order INTEGER NOT NULL,
        status VARCHAR(50) NOT NULL,
        prompt_sent TEXT,
        llm_response TEXT,
        criteria_result JSONB,
        retry_count INTEGER DEFAULT 0,
        started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        completed_at TIMESTAMP,
        error_message TEXT
      )
    `);

    // Create indexes for performance
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_workflow_steps_workflow_id ON workflow_steps(workflow_id);
      CREATE INDEX IF NOT EXISTS idx_workflow_executions_workflow_id ON workflow_executions(workflow_id);
      CREATE INDEX IF NOT EXISTS idx_step_executions_execution_id ON step_executions(execution_id);
    `);

    await client.query('COMMIT');
    console.log('✓ Database tables created successfully');
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error creating tables:', error);
    throw error;
  } finally {
    client.release();
  }
};

export default createTables;