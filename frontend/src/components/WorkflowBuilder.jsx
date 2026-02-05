import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import api from '../api';

export default function WorkflowBuilder() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [workflow, setWorkflow] = useState(null);
  const [models, setModels] = useState([]);
  const [showStepModal, setShowStepModal] = useState(false);
  const [editingStep, setEditingStep] = useState(null);
  const [stepForm, setStepForm] = useState({
    name: '',
    model: 'gpt-3.5-turbo',
    prompt: '',
    completion_criteria: { type: 'contains_text', value: 'SUCCESS' },
    context_strategy: 'full',
    max_retries: 2
  });

  useEffect(() => {
    loadWorkflow();
    loadModels();
  }, [id]);

  const loadWorkflow = async () => {
    const data = await api.getWorkflow(id);
    setWorkflow(data);
  };

  const loadModels = async () => {
    const data = await api.getModels();
    setModels(data);
  };

  const openStepModal = (step = null) => {
    if (step) {
      setEditingStep(step);
      setStepForm({
        name: step.name,
        model: step.model,
        prompt: step.prompt,
        completion_criteria: step.completion_criteria,
        context_strategy: step.context_strategy,
        max_retries: step.max_retries
      });
    } else {
      setEditingStep(null);
      setStepForm({
        name: '',
        model: 'gpt-3.5-turbo',
        prompt: '',
        completion_criteria: { type: 'contains_text', value: 'SUCCESS' },
        context_strategy: 'full',
        max_retries: 2
      });
    }
    setShowStepModal(true);
  };

  const saveStep = async (e) => {
    e.preventDefault();
    try {
      if (editingStep) {
        await api.updateStep(editingStep.id, stepForm);
      } else {
        await api.addStep(id, stepForm);
      }
      setShowStepModal(false);
      loadWorkflow();
    } catch (error) {
      alert('Error saving step: ' + error.message);
    }
  };

  const deleteStep = async (stepId) => {
    if (!confirm('Delete this step?')) return;
    try {
      await api.deleteStep(stepId);
      loadWorkflow();
    } catch (error) {
      alert('Error deleting step: ' + error.message);
    }
  };

  const executeWorkflow = async () => {
    try {
      console.log(`[Builder] Triggering execution for workflow ${id}`);
      await api.executeWorkflow(id);
      console.log('[Builder] Execution started, navigating...');
      navigate(`/workflow/${id}/execute`);
    } catch (error) {
      console.error('[Builder] Error starting execution:', error);
      alert('Error starting execution: ' + error.message);
    }
  };

  if (!workflow) return <div className="loading">Loading workflow...</div>;

  return (
    <div>
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '20px' }}>
          <div>
            <h2>{workflow.name}</h2>
            <p style={{ color: '#666' }}>{workflow.description}</p>
          </div>
          <div style={{ display: 'flex', gap: '10px' }}>
            <button className="btn btn-secondary" onClick={() => navigate('/')}>
              Back
            </button>
            <button
              className="btn btn-success"
              onClick={executeWorkflow}
              disabled={!workflow.steps || workflow.steps.length === 0}
            >
              ▶️ Run Workflow
            </button>
          </div>
        </div>

        <h3>Steps ({workflow.steps?.length || 0})</h3>

        {workflow.steps?.map((step, index) => (
          <div key={step.id} className="step-card">
            <h4>Step {index + 1}: {step.name}</h4>
            <p><strong>Model:</strong> {step.model}</p>
            <p><strong>Criteria:</strong> {step.completion_criteria.type} = {JSON.stringify(step.completion_criteria.value)}</p>
            <p><strong>Context:</strong> {step.context_strategy}</p>
            <div className="action-buttons">
              <button className="btn btn-secondary" onClick={() => openStepModal(step)}>
                Edit
              </button>
              <button className="btn btn-danger" onClick={() => deleteStep(step.id)}>
                Delete
              </button>
            </div>
          </div>
        ))}

        <button className="btn btn-primary" onClick={() => openStepModal()}>
          + Add Step
        </button>
      </div>

      {showStepModal && (
        <div className="modal-overlay" onClick={() => setShowStepModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>{editingStep ? 'Edit Step' : 'Add Step'}</h2>
            <form onSubmit={saveStep}>
              <div className="form-group">
                <label>Step Name</label>
                <input
                  value={stepForm.name}
                  onChange={(e) => setStepForm({ ...stepForm, name: e.target.value })}
                  required
                />
              </div>
              <div className="form-group">
                <label>Model</label>
                <select
                  value={stepForm.model}
                  onChange={(e) => setStepForm({ ...stepForm, model: e.target.value })}
                >
                  {models.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label>Prompt</label>
                <textarea
                  value={stepForm.prompt}
                  onChange={(e) => setStepForm({ ...stepForm, prompt: e.target.value })}
                  rows="5"
                  required
                />
              </div>
              <div className="form-group">
                <label>Completion Criteria Type</label>
                <select
                  value={stepForm.completion_criteria.type}
                  onChange={(e) => setStepForm({
                    ...stepForm,
                    completion_criteria: { type: e.target.value, value: '' }
                  })}
                >
                  <option value="contains_text">Contains Text</option>
                  <option value="regex_match">Regex Match</option>
                  <option value="valid_json">Valid JSON</option>
                  <option value="contains_code">Contains Code</option>
                  <option value="min_length">Min Length</option>
                </select>
              </div>
              <div className="form-group">
                <label>Criteria Value</label>
                <input
                  value={stepForm.completion_criteria.value}
                  onChange={(e) => setStepForm({
                    ...stepForm,
                    completion_criteria: { ...stepForm.completion_criteria, value: e.target.value }
                  })}
                />
              </div>
              <div className="form-group">
                <label>Context Strategy</label>
                <select
                  value={stepForm.context_strategy}
                  onChange={(e) => setStepForm({ ...stepForm, context_strategy: e.target.value })}
                >
                  <option value="full">Full Output</option>
                  <option value="summary">Summary (500 chars)</option>
                  <option value="code_only">Code Blocks Only</option>
                </select>
              </div>
              <div className="action-buttons">
                <button type="submit" className="btn btn-primary">Save</button>
                <button type="button" className="btn btn-secondary" onClick={() => setShowStepModal(false)}>
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}