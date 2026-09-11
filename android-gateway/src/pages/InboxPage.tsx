import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useGateway } from '../services/GatewayContext';

export default function InboxPage() {
  const { messages, clearMessages } = useGateway();
  const navigate = useNavigate();

  const incoming = messages
    .filter(m => m.direction === 'incoming')
    .sort((a, b) => b.timestamp - a.timestamp);

  return (
    <div className="message-page">
      <div className="page-header">
        <button className="btn-back" onClick={() => navigate('/dashboard')}>← Back</button>
        <h2>📥 SMS Inbox (MO)</h2>
        <span className="msg-count">{incoming.length} messages</span>
      </div>

      {incoming.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon">📭</div>
          <p>No incoming SMS yet</p>
          <p className="empty-hint">Incoming messages will appear here when your phone receives SMS</p>
        </div>
      ) : (
        <div className="message-list">
          {incoming.map(msg => (
            <div key={msg.id} className="message-item incoming">
              <div className="msg-header">
                <span className="msg-from">{msg.from}</span>
                <span className="msg-time">
                  {new Date(msg.timestamp).toLocaleString()}
                </span>
              </div>
              <div className="msg-body">{msg.text}</div>
              <div className="msg-footer">
                <span className={`msg-badge ${msg.serverSynced ? 'synced' : 'pending'}`}>
                  {msg.serverSynced ? '✅ Synced' : '⏳ Pending'}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {incoming.length > 0 && (
        <button className="btn btn-danger btn-clear" onClick={clearMessages}>
          🗑 Clear All
        </button>
      )}

      {/* Navigation */}
      <div className="nav-bar">
        <button className="nav-btn" onClick={() => navigate('/dashboard')}>
          <span>📊</span> Dashboard
        </button>
        <button className="nav-btn active" onClick={() => navigate('/inbox')}>
          <span>📥</span> Inbox
        </button>
        <button className="nav-btn" onClick={() => navigate('/outbox')}>
          <span>📤</span> Outbox
        </button>
      </div>
    </div>
  );
}
