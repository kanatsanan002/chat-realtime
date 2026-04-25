import { useState, useEffect, useRef } from 'react';
import './App.css';

interface Message {
  username: string;
  text: string;
  avatar: string;
  type?: string;
}

interface User {
  username: string;
  avatar: string;
}

function App() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputMessage, setInputMessage] = useState('');
  const [isConnected, setIsConnected] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [avatar, setAvatar] = useState('');
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [isRegisterMode, setIsRegisterMode] = useState(false);
  const [users, setUsers] = useState<User[]>([]);
  const [error, setError] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  
  const ws = useRef<WebSocket | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const getDiceBearAvatar = (name: string) => `https://api.dicebear.com/7.x/avataaars/svg?seed=${name || 'default'}`;

  // Auto-detect backend URL based on current environment
  const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
  
  // Specific Render backend URL provided by user
  const prodBaseUrl = 'chat-realtime-backend-ky91.onrender.com';
  
  const API_URL = import.meta.env.VITE_API_URL || (isLocal ? 'http://127.0.0.1:8000' : `https://${prodBaseUrl}`);
  const WS_URL = import.meta.env.VITE_WS_URL || (isLocal ? 'ws://127.0.0.1:8000/ws' : `wss://${prodBaseUrl}/ws`);

  useEffect(() => {
    if (!isLoggedIn) return;

    let socket: WebSocket;
    
    const connect = () => {
      socket = new WebSocket(WS_URL);
      ws.current = socket;

      socket.onopen = () => {
        setIsConnected(true);
        setError('');
        socket.send(JSON.stringify({
          type: 'join',
          username: username,
          avatar: avatar
        }));
      };
      
      socket.onclose = () => {
        setIsConnected(false);
        // Try to reconnect after 3 seconds
        setTimeout(() => {
          if (isLoggedIn) {
            console.log("Attempting to reconnect...");
            connect();
          }
        }, 3000);
      };

      socket.onerror = (err) => {
        console.error("WebSocket error:", err);
        setError("Connection error. Is the backend running?");
      };
      
      socket.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === 'message') {
            setMessages(prev => [...prev, data]);
          } else if (data.type === 'user_list') {
            setUsers(data.users);
          }
        } catch (e) {
          console.error("Failed to parse message", e);
        }
      };
    };

    connect();

    return () => {
      if (socket) {
        socket.close();
      }
    };
  }, [isLoggedIn, username, avatar]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    const endpoint = isRegisterMode ? 'register' : 'login';
    
    try {
      const response = await fetch(`${API_URL}/${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || 'Authentication failed');

      if (isRegisterMode) {
        setIsRegisterMode(false);
        setPassword('');
        setError('Registration successful! Please login.');
      } else {
        setUsername(data.username);
        setAvatar(data.avatar);
        setIsLoggedIn(true);
      }
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleLogout = () => {
    setIsLoggedIn(false);
    setUsername('');
    setPassword('');
    setAvatar('');
    ws.current?.close();
  };

  const updateAvatar = async () => {
    const newAvatar = getDiceBearAvatar(Math.random().toString());
    try {
      const response = await fetch(`${API_URL}/profile`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, avatar: newAvatar })
      });
      if (response.ok) {
        setAvatar(newAvatar);
        ws.current?.send(JSON.stringify({
          type: 'profile_update',
          username: username,
          avatar: newAvatar
        }));
      }
    } catch (err) {
      console.error("Failed to update avatar");
    }
  };

  const sendMessage = (e: React.FormEvent) => {
    e.preventDefault();
    if (inputMessage.trim() && ws.current?.readyState === WebSocket.OPEN) {
      ws.current.send(JSON.stringify({
        type: 'message',
        username: username,
        avatar: avatar,
        text: inputMessage
      }));
      setInputMessage('');
    }
  };

  if (!isLoggedIn) {
    return (
      <div className="login-container">
        <div className="login-card">
          <h1>{isRegisterMode ? 'Create Account' : 'Welcome Back'}</h1>
          {error && <div className={`auth-message ${error.includes('successful') ? 'success' : 'error'}`}>{error}</div>}
          <form onSubmit={handleAuth}>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Username"
              required
            />
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Password"
              required
            />
            <button type="submit">
              {isRegisterMode ? 'Register' : 'Login'}
            </button>
          </form>
          <p className="auth-toggle">
            {isRegisterMode ? 'Already have an account?' : "Don't have an account?"}
            <button onClick={() => { setIsRegisterMode(!isRegisterMode); setError(''); }}>
              {isRegisterMode ? 'Login' : 'Register'}
            </button>
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="app-layout">
      <aside className="users-sidebar">
        <div className="sidebar-header">
          Online Users ({users.length})
        </div>
        <div className="users-list">
          {users.map((u, i) => (
            <div key={i} className={`user-item ${u.username === username ? 'me' : ''}`}>
              <img src={u.avatar} alt={u.username} className="user-avatar-small" />
              <span>{u.username} {u.username === username ? '(You)' : ''}</span>
              <div className="online-indicator"></div>
            </div>
          ))}
        </div>
        <div className="sidebar-footer">
          <button onClick={handleLogout} className="logout-btn">Logout</button>
        </div>
      </aside>

      <div className="chat-container">
        <header className="chat-header">
          <div className="user-info">
            <div className="profile-trigger" onClick={() => setShowSettings(!showSettings)}>
              <img src={avatar} alt="My Avatar" className="my-avatar-header" title="Change Profile" />
              <div className="edit-overlay">Edit</div>
            </div>
            <div>
              <h1>Real-time Chat</h1>
              <span className="current-user">Logged as <strong>{username}</strong></span>
            </div>
          </div>
          <span className={`status ${isConnected ? 'connected' : 'disconnected'}`}>
            {isConnected ? 'Connected' : 'Disconnected'}
          </span>
        </header>

        {showSettings && (
          <div className="settings-panel">
            <h3>Profile Settings</h3>
            <div className="settings-avatar-group">
              <img src={avatar} alt="Current Avatar" />
              <button onClick={updateAvatar}>Randomize Avatar</button>
            </div>
            <button onClick={() => setShowSettings(false)} className="close-settings">Done</button>
          </div>
        )}

        <div className="messages-container">
          {messages.length === 0 ? (
            <div className="empty-state">No messages yet. Start chatting!</div>
          ) : (
            messages.map((msg, index) => {
              const isSelf = msg.username === username;
              return (
                <div key={index} className={`message-wrapper ${isSelf ? 'self' : 'other'}`}>
                  {!isSelf && (
                    <div className="message-header">
                      <img src={msg.avatar} alt={msg.username} className="message-avatar" />
                      <span className="user-id">{msg.username}</span>
                    </div>
                  )}
                  <div className="message-bubble">
                    {msg.text}
                  </div>
                </div>
              );
            })
          )}
          <div ref={messagesEndRef} />
        </div>

        <form className="input-form" onSubmit={sendMessage}>
          <input
            type="text"
            value={inputMessage}
            onChange={(e) => setInputMessage(e.target.value)}
            placeholder="Type a message..."
            disabled={!isConnected}
          />
          <button type="submit" disabled={!isConnected || !inputMessage.trim()}>
            Send
          </button>
        </form>
      </div>
    </div>
  );
}

export default App;
