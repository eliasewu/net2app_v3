import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useGateway } from '../services/GatewayContext';

export default function OutboxPage() {
  const { messages, clearMessages } = useGateway();
  const navigate = useNavigate();

  const outgoing = messages
    .filter(m => m.direction === 'outgoing')
    .sort((a, b) => b.timestamp - a.timestamp);

  const statusIcon = (status: string) => {
    switch (status) {
      case 'delivered': return '✅';
      case 'sent': return '📤';
      case 'failed': return '❌';
      case 'pending': return '⏳';
      default: return '⬜';
    }
  };

  return (
    <div className="message-page">
      <div className="page-header">
        <button className="btn-back" onClick={() => navigate('/dashboard')}>← Back</button>
        <h2>📤 SMS Outbox (MT)</h2>
        <span className="msg-count">{outgoing.length} messages</span>
      </div>

      {outgoing.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon">📮</div>
          <p>No outgoing SMS yet</p>
          <p className="empty-hint">Messages sent from this device will appear here</p>
        </div>
      ) : (
        <div className="message-list">
          {outgoing.map(msg => (
            <div key={msg.id} className={`message-item outgoing status-${msg.status}`}>
              <div className="msg-header">
                <span className="msg-to">To: {msg.to}</span>
                <span className="msg-status">{statusIcon(msg.status)} {msg.status}</span>
              </div>
              <div className="msg-body">{msg.text}</div>
              <div className="msg-footer">
                <span className="msg-time">
                  {new Date(msg.timestamp).toLocaleString()}
                </span>
                <span className={`msg-badge ${msg.serverSynced ? 'synced' : 'pending'}`}>
                  {msg.serverSynced ? '✅ Synced' : '⏳ Pending'}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {outgoing.length > 0 && (
        <button className="btn btn-danger btn-clear" onClick={clearMessages}>
          🗑 Clear All
        </button>
      )}

      {/* Navigation */}
      <div className="nav-bar">
        <button className="nav-btn" onClick={() => navigate('/dashboard')}>
          <span>📊</span> Dashboard
        </button>
        <button className="nav-btn" onClick={() => navigate('/inbox')}>
          <span>📥</span> Inbox
        </button>
        <button className="nav-btn active" onClick={() => navigate('/outbox')}>
          <span>📤</span> Outbox
        </button>
      </div>
    </div>
  );
}
