import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import api from '../api';

export default function WorkflowExecutor() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [execution, setExecution] = useState(null);
  const [progress, setProgress] = useState({ current: 0, total: 0, status: 'running' });
  const [ws, setWs] = useState(null);
  const [isConnected, setIsConnected] = useState(false);
  const notifiedSwitches = useRef(new Set());

  useEffect(() => {
    loadLatestExecution();
    notifiedSwitches.current.clear();

    // Use a ref to track if component is mounted to prevent state updates on unmount
    let isMounted = true;
    let ws = null;

    console.log('[WorkflowExecutor] Component Mounted');

    const connect = () => {
      if (!isMounted) return;
      console.log('[WorkflowExecutor] Initiating WebSocket connection...');
      if (!isMounted) return;

      ws = api.connectWebSocket((data) => {
        if (!isMounted) return;

        if (data.type === 'connected') {
          setIsConnected(true);
        }

        if (data.type === 'model_switched') {
          // Update model in UI state
          setExecution(prev => {
            if (!prev) return prev;
            const newSteps = prev.steps.map(step => {
              if (step.step_name === data.stepName) {
                return { ...step, model: data.newModel };
              }
              return step;
            });
            return { ...prev, steps: newSteps };
          });

          // Notify user if not already notified for this model
          if (!notifiedSwitches.current.has(data.originalModel)) {
            alert(`⚠️ Model Switched: ${data.originalModel} failed. Switched to ${data.newModel}.`);
            notifiedSwitches.current.add(data.originalModel);
          }
        }

        if (data.type === 'execution_update') {
          setProgress({
            current: data.currentStep || 0,
            total: data.totalSteps || 0,
            status: data.status,
            stepName: data.stepName
          });

          // Handle real-time step updates
          if (data.stepUpdate) {
            setExecution(prev => {
              if (!prev) return prev;
              const newSteps = prev.steps.map(step => {
                if (step.step_name === data.stepUpdate.stepName || step.step_name === data.stepName) {
                  return {
                    ...step,
                    status: data.stepUpdate.status,
                    llm_response: data.stepUpdate.llmResponse || step.llm_response,
                    criteria_result: data.stepUpdate.criteriaResult || step.criteria_result
                  };
                }
                return step;
              });
              return { ...prev, steps: newSteps };
            });
          }

          if (data.status === 'completed' || data.status === 'failed') {
            setTimeout(() => {
              if (isMounted) loadLatestExecution();
            }, 1000);
          }
        }
      });

      // Manually set connected since we might miss the first message
      if (ws.readyState === 1) setIsConnected(true);

      ws.onopen = () => {
        if (isMounted) setIsConnected(true);
        // Client-side heartbeat to keep connection alive
        const clientPing = setInterval(() => {
          if (ws.readyState === 1) {
            ws.send(JSON.stringify({ type: 'ping' }));
          }
        }, 5000);

        ws.onclose = () => {
          clearInterval(clientPing);
          if (isMounted) {
            console.log('WebSocket closed, attempting to reconnect...');
            setIsConnected(false);
            setTimeout(connect, 3000);
          }
        };
      };

      setWs(ws);

      // Removed duplicate onclose definition since it's now inside onopen scope or handled above
    };

    connect();

    return () => {
      console.log('[WorkflowExecutor] Component Unmounting - Closing WebSocket');
      isMounted = false;
      if (ws) {
        ws.onclose = null; // Prevent reconnect on cleanup
        ws.close();
      }
    };
  }, [id]);

  const loadLatestExecution = async () => {
    const executions = await api.getExecutions(id);
    if (executions.length > 0) {
      const latest = executions[0];
      const details = await api.getExecution(latest.id);
      setExecution(details);
      setProgress({
        current: details.steps?.length || 0,
        total: details.steps?.length || 0,
        status: details.status
      });
    }
  };

  const progressPercent = progress.total > 0 ? (progress.current / progress.total) * 100 : 0;

  return (
    <div>
      <button className="btn btn-secondary" onClick={() => navigate(`/workflow/${id}`)}>
        ← Back to Builder
      </button>

      <div className="execution-progress">
        <h2>Workflow Execution</h2>
        <div className="badge badge-{progress.status}">
          {progress.status.toUpperCase()}
        </div>
        <div className="progress-bar">
          <div className="progress-fill" style={{ width: `${progressPercent}%` }} />
        </div>
        <p>Step {progress.current} of {progress.total} {progress.stepName && `- ${progress.stepName}`}</p>

      </div>

      {execution?.steps?.map((step, index) => (
        <div key={step.id} className="card">
          <h3>Step {index + 1}: {step.step_name}</h3>
          <div className="badge badge-{step.status}">{step.status}</div>
          <p><strong>Model:</strong> {step.model}</p>
          {step.retry_count > 0 && <p><strong>Retries:</strong> {step.retry_count}</p>}

          {step.llm_response && (
            <>
              <h4>LLM Response:</h4>
              <pre>{step.llm_response}</pre>
            </>
          )}

          {step.criteria_result && (
            <>
              <h4>Criteria Result:</h4>
              <p><strong>Passed:</strong> {step.criteria_result.passed ? '✅ Yes' : '❌ No'}</p>
              <p><strong>Reason:</strong> {step.criteria_result.reason}</p>
            </>
          )}
        </div>
      ))}

      <div className="connection-status" style={{
        position: 'fixed',
        bottom: '20px',
        right: '20px',
        padding: '10px',
        backgroundColor: '#1e293b',
        border: '1px solid #334155',
        borderRadius: '8px',
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        fontSize: '14px',
        zIndex: 9999,
        boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)'
      }}>
        <div style={{
          width: '12px',
          height: '12px',
          borderRadius: '50%',
          backgroundColor: isConnected ? '#4ade80' : '#ef4444',
          boxShadow: isConnected ? '0 0 8px #4ade80' : '0 0 8px #ef4444'
        }} />
        <span style={{ color: '#fff' }}>
          {isConnected ? 'Connected to Server' : 'Reconnecting...'}
        </span>
      </div>
    </div>
  );
}