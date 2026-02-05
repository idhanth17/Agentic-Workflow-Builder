const API_BASE = '/api';
const WS_URL = 'ws://localhost:5001';

class ApiService {
  async request(endpoint, options = {}) {
    console.log(`[API] Requesting: ${endpoint}`, options);
    const response = await fetch(`${API_BASE}${endpoint}`, {
      headers: { 'Content-Type': 'application/json', ...options.headers },
      ...options,
    });
    console.log(`[API] Response status: ${response.status}`);
    if (!response.ok) {
      const error = await response.json();
      console.error('[API] Request failed:', error);
      throw new Error(error.error || 'Request failed');
    }
    return response.json();
  }

  // Workflows
  async getWorkflows() { return this.request('/workflows'); }
  async getWorkflow(id) { return this.request(`/workflows/${id}`); }
  async createWorkflow(data) { return this.request('/workflows', { method: 'POST', body: JSON.stringify(data) }); }
  async updateWorkflow(id, data) { return this.request(`/workflows/${id}`, { method: 'PUT', body: JSON.stringify(data) }); }
  async deleteWorkflow(id) { return this.request(`/workflows/${id}`, { method: 'DELETE' }); }

  // Steps
  async addStep(workflowId, data) { return this.request(`/workflows/${workflowId}/steps`, { method: 'POST', body: JSON.stringify(data) }); }
  async updateStep(stepId, data) { return this.request(`/steps/${stepId}`, { method: 'PUT', body: JSON.stringify(data) }); }
  async deleteStep(stepId) { return this.request(`/steps/${stepId}`, { method: 'DELETE' }); }

  // Execution
  async executeWorkflow(id) { return this.request(`/workflows/${id}/execute`, { method: 'POST' }); }
  async getExecutions(workflowId) { return this.request(`/workflows/${workflowId}/executions`); }
  async getExecution(id) { return this.request(`/executions/${id}`); }

  // Models
  async getModels() { return this.request('/models'); }

  // WebSocket
  connectWebSocket(onMessage) {
    const ws = new WebSocket(WS_URL);
    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'ping') {
          // Respond to server heartbeat
          console.log('[API] Sending Pong');
          ws.send(JSON.stringify({ type: 'pong' }));
          return;
        }
        onMessage(data);
      } catch (e) {
        console.error('Error parsing WS message:', e);
      }
    };
    ws.onerror = (error) => console.error('WebSocket error:', error);
    return ws;
  }
}

export default new ApiService();