import pool from './db.js';
import createTables from './schema.js';

const seedDatabase = async () => {
  await createTables();
  
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');

    // Check if workflows already exist
    const existing = await client.query('SELECT COUNT(*) FROM workflows');
    
    if (existing.rows[0].count > 0) {
      console.log('✓ Database already seeded');
      await client.query('ROLLBACK');
      return;
    }

    // Create example workflow: Build a Calculator
    const workflowResult = await client.query(
      `INSERT INTO workflows (name, description) 
       VALUES ($1, $2) 
       RETURNING id`,
      [
        'Build Calculator Application',
        'Multi-step workflow to create a Python calculator with tests'
      ]
    );
    
    const workflowId = workflowResult.rows[0].id;

    // Step 1: Write calculator code
    await client.query(
      `INSERT INTO workflow_steps (
        workflow_id, step_order, name, model, prompt, 
        completion_criteria, context_strategy, max_retries
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        workflowId,
        1,
        'Write Calculator Code',
        'gpt-4o-mini',
        'Write a Python calculator function that supports +, -, *, / operations. Include input validation and error handling. Make sure to include the word SUCCESS when done.',
        JSON.stringify({
          type: 'contains_text',
          value: 'SUCCESS'
        }),
        'full',
        2
      ]
    );

    // Step 2: Write unit tests
    await client.query(
      `INSERT INTO workflow_steps (
        workflow_id, step_order, name, model, prompt, 
        completion_criteria, context_strategy, max_retries
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        workflowId,
        2,
        'Write Unit Tests',
        'gpt-4o-mini',
        'Based on the calculator code provided above, write comprehensive unit tests. Include the word SUCCESS when complete.',
        JSON.stringify({
          type: 'contains_code',
          value: true
        }),
        'code_only',
        2
      ]
    );

    // Step 3: Generate installation instructions
    await client.query(
      `INSERT INTO workflow_steps (
        workflow_id, step_order, name, model, prompt, 
        completion_criteria, context_strategy, max_retries
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        workflowId,
        3,
        'Installation Instructions',
        'gpt-4o-mini',
        'Generate installation and setup instructions for this project. Include package requirements and how to run tests.',
        JSON.stringify({
          type: 'min_length',
          value: 100
        }),
        'summary',
        2
      ]
    );

    await client.query('COMMIT');
    console.log('✓ Example workflow created successfully');
    console.log(`  Workflow ID: ${workflowId}`);
    console.log(`  Steps: 3`);

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error seeding database:', error);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
};

seedDatabase();