import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api';

export default function WorkflowList() {
  const [workflows, setWorkflows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [newWorkflow, setNewWorkflow] = useState({ name: '', description: '' });
  const navigate = useNavigate();

  useEffect(() => { loadWorkflows(); }, []);

  const loadWorkflows = async () => {
    try {
      const data = await api.getWorkflows();
      setWorkflows(data);
    } catch (error) {
      console.error('Error loading workflows:', error);
    } finally {
      setLoading(false);
    }
  };

  const createWorkflow = async (e) => {
    e.preventDefault();
    try {
      const workflow = await api.createWorkflow(newWorkflow);
      setShowModal(false);
      navigate(`/workflow/${workflow.id}`);
    } catch (error) {
      alert('Error creating workflow: ' + error.message);
    }
  };

  if (loading) return <div className="loading">Loading workflows...</div>;

  return (
    <>
      <div style={{ marginBottom: '20px' }}>
        <button className="btn btn-primary" onClick={() => setShowModal(true)}>
          + Create New Workflow
        </button>
      </div>

      {workflows.length === 0 ? (
        <div className="empty-state">
          <h2>No workflows yet</h2>
          <p>Create your first AI workflow to get started!</p>
        </div>
      ) : (
        <div className="workflows-grid">
          {workflows.map((workflow) => (
            <div
              key={workflow.id}
              className="workflow-card"
              onClick={() => navigate(`/workflow/${workflow.id}`)}
            >
              <h3>{workflow.name}</h3>
              <p>{workflow.description || 'No description'}</p>
              <div className="workflow-stats">
                <span>📝 {workflow.step_count} steps</span>
                <span>▶️ {workflow.execution_count} runs</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Create New Workflow</h2>
            <form onSubmit={createWorkflow}>
              <div className="form-group">
                <label>Name</label>
                <input
                  type="text"
                  value={newWorkflow.name}
                  onChange={(e) => setNewWorkflow({...newWorkflow, name: e.target.value})}
                  required
                />
              </div>
              <div className="form-group">
                <label>Description</label>
                <textarea
                  value={newWorkflow.description}
                  onChange={(e) => setNewWorkflow({...newWorkflow, description: e.target.value})}
                />
              </div>
              <div className="action-buttons">
                <button type="submit" className="btn btn-primary">Create</button>
                <button type="button" className="btn btn-secondary" onClick={() => setShowModal(false)}>
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}