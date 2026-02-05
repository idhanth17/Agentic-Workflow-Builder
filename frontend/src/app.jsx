import { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, useNavigate } from 'react-router-dom';
import api from './api';
import WorkflowList from './components/WorkflowList';
import WorkflowBuilder from './components/WorkflowBuilder';
import WorkflowExecutor from './components/WorkflowExecutor';

function App() {
  return (
    <BrowserRouter>
      <div className="app">
        <div className="header">
          <h1>🤖 Agentic Workflow Builder</h1>
          <p>Build multi-step AI workflows with automatic context passing</p>
        </div>
        <Routes>
          <Route path="/" element={<WorkflowList />} />
          <Route path="/workflow/:id" element={<WorkflowBuilder />} />
          <Route path="/workflow/:id/execute" element={<WorkflowExecutor />} />
        </Routes>
      </div>
    </BrowserRouter>
  );
}

export default App;