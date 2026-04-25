import { useState, useEffect, useRef } from 'react';
import './App.css';

interface Message {
  id?: string;
  username: string;
  text: string;
  avatar: string;
  timestamp?: string;
  isRead?: boolean;
  type?: string;
  room_id?: string;
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
  const [currentRoom, setCurrentRoom] = useState('global');
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [notifications, setNotifications] = useState<{[key: string]: number}>({});
  const [typingUsers, setTypingUsers] = useState<string[]>([]);
  
  const ws = useRef<WebSocket | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const notificationSound = useRef<HTMLAudioElement | null>(null);
  const roomRef = useRef('global');
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    roomRef.current = currentRoom;
  }, [currentRoom]);

  const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
  const API_URL = isLocal ? 'http://127.0.0.1:8000' : 'https://chat-realtime-backend-ky91.onrender.com';
  const WS_URL = isLocal ? 'ws://127.0.0.1:8000/ws' : 'wss://chat-realtime-backend-ky91.onrender.com/ws';

  useEffect(() => {
    const savedUser = localStorage.getItem('chat_user');
    if (savedUser) {
      const parsedUser = JSON.parse(savedUser);
      setUsername(parsedUser.username);
      setAvatar(parsedUser.avatar);
      setIsLoggedIn(true);
    }
    notificationSound.current = new Audio('https://assets.mixkit.co/active_storage/sfx/2354/2354-preview.mp3');
    notificationSound.current.volume = 0.5;
  }, []);

  useEffect(() => {
    if (!isLoggedIn) return;
    const fetchHistory = async () => {
      try {
        const response = await fetch(`${API_URL}/messages/${currentRoom}`);
        if (response.ok) {
          const data = await response.json();
          setMessages(data);
        }
      } catch (err) {
        console.error("Failed to fetch history");
      }
    };
    fetchHistory();
  }, [isLoggedIn, currentRoom]);

  useEffect(() => {
    if (!isLoggedIn) return;

    let socket: WebSocket | null = null;
    const connect = () => {
      if (socket) socket.close();
      socket = new WebSocket(WS_URL);
      ws.current = socket;

      socket.onopen = () => {
        setIsConnected(true);
        setError('');
        socket?.send(JSON.stringify({
          type: 'join',
          username: username,
          avatar: avatar
        }));
      };
      
      socket.onclose = () => {
        setIsConnected(false);
        if (isLoggedIn) setTimeout(connect, 3000);
      };

      socket.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === 'message') {
            const msgRoomId = data.room_id || 'global';
            if (msgRoomId === roomRef.current) {
              setMessages(prev => {
                if (prev.find(m => m.id === data.id)) return prev;
                return [...prev, data];
              });
            } else {
              setNotifications(prev => ({
                ...prev,
                [msgRoomId]: (prev[msgRoomId] || 0) + 1
              }));
            }
            if (data.username !== username && notificationSound.current) {
              notificationSound.current.play().catch(() => {});
            }
          } else if (data.type === 'typing') {
            if (data.room_id === roomRef.current && data.username !== username) {
              if (data.isTyping) {
                setTypingUsers(prev => prev.includes(data.username) ? prev : [...prev, data.username]);
              } else {
                setTypingUsers(prev => prev.filter(u => u !== data.username));
              }
            }
          } else if (data.type === 'user_list') {
            setUsers(data.users);
          }
        } catch (e) {
          console.error("Parse error", e);
        }
      };
    };

    connect();
    return () => { socket?.close(); };
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
      if (!response.ok) throw new Error(data.detail || 'Auth failed');
      if (isRegisterMode) {
        setIsRegisterMode(false);
        setError('Success! Please login.');
      } else {
        localStorage.setItem('chat_user', JSON.stringify({ username: data.username, avatar: data.avatar }));
        setUsername(data.username);
        setAvatar(data.avatar);
        setIsLoggedIn(true);
      }
    } catch (err: any) { setError(err.message); }
  };

  const handleLogout = () => {
    localStorage.removeItem('chat_user');
    setIsLoggedIn(false);
    ws.current?.close();
  };

  const selectChat = (user: User | null) => {
    setSelectedUser(user);
    setMessages([]);
    let newRoom = 'global';
    if (user) {
      const sortedUsers = [username, user.username].sort();
      newRoom = `private_${sortedUsers[0]}_${sortedUsers[1]}`;
    }
    setCurrentRoom(newRoom);
    setNotifications(prev => ({ ...prev, [newRoom]: 0 }));
    setTypingUsers([]);
  };

  const sendTypingStatus = (isTyping: boolean) => {
    if (ws.current?.readyState === WebSocket.OPEN) {
      ws.current.send(JSON.stringify({
        type: 'typing',
        username: username,
        room_id: currentRoom,
        isTyping: isTyping
      }));
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setInputMessage(e.target.value);
    
    // Send typing start
    sendTypingStatus(true);

    // Debounce typing stop
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = setTimeout(() => {
      sendTypingStatus(false);
    }, 2000);
  };

  const sendMessage = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputMessage.trim()) return;
    if (ws.current?.readyState === WebSocket.OPEN) {
      ws.current.send(JSON.stringify({
        type: 'message',
        username: username,
        avatar: avatar,
        text: inputMessage,
        room_id: currentRoom
      }));
      sendTypingStatus(false); // Stop typing after sending
      setInputMessage('');
    }
  };

  if (!isLoggedIn) {
    return (
      <div className="login-container">
        <div className="login-card">
          <h1>chatweb</h1>
          {error && <div className={`auth-message ${error.includes('Success') ? 'success' : 'error'}`}>{error}</div>}
          <form onSubmit={handleAuth}>
            <input type="text" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="Username" required />
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password" required />
            <button type="submit">{isRegisterMode ? 'Register' : 'Login'}</button>
          </form>
          <button className="auth-toggle" onClick={() => setIsRegisterMode(!isRegisterMode)}>
            {isRegisterMode ? 'Switch to Login' : 'Create Account'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="app-layout">
      <aside className="users-sidebar">
        <div className="sidebar-header">chatweb</div>
        <div className="users-list">
          <div className={`user-item ${currentRoom === 'global' ? 'me' : ''}`} onClick={() => selectChat(null)}>
            <div className="global-icon">🌍</div>
            <span>Global Chat</span>
            {notifications['global'] > 0 && <div className="unread-badge">{notifications['global']}</div>}
          </div>
          <div className="sidebar-divider">Private Messages</div>
          {users.filter(u => u.username !== username).map((u, i) => {
            const sortedUsers = [username, u.username].sort();
            const roomId = `private_${sortedUsers[0]}_${sortedUsers[1]}`;
            const unreadCount = notifications[roomId] || 0;
            return (
              <div key={i} className={`user-item ${selectedUser?.username === u.username ? 'me' : ''}`} onClick={() => selectChat(u)}>
                <img src={u.avatar} alt={u.username} className="user-avatar-small" />
                <span>{u.username}</span>
                {unreadCount > 0 && <div className="unread-badge">{unreadCount}</div>}
                <div className="online-indicator"></div>
              </div>
            );
          })}
        </div>
        <div className="sidebar-footer">
          <button onClick={handleLogout} className="logout-btn">Logout</button>
        </div>
      </aside>

      <div className="chat-container">
        <header className="chat-header">
          <div className="user-info">
            <h1>{selectedUser ? `Chat with ${selectedUser.username}` : 'Global Chat'}</h1>
          </div>
          <span className={`status ${isConnected ? 'connected' : 'disconnected'}`}>
            {isConnected ? 'Connected' : 'Disconnected'}
          </span>
        </header>

        <div className="messages-container">
          {messages.length === 0 ? (
            <div className="empty-state">No messages here yet.</div>
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
                    <div className="message-info">
                      <span className="message-time">{msg.timestamp}</span>
                    </div>
                  </div>
                </div>
              );
            })
          )}
          <div ref={messagesEndRef} />
        </div>

        {typingUsers.length > 0 && (
          <div className="typing-indicator-container">
            <div className="typing-bubble">
              <span className="dot"></span>
              <span className="dot"></span>
              <span className="dot"></span>
            </div>
            <span className="typing-text">{typingUsers.join(', ')} is typing...</span>
          </div>
        )}

        <form className="input-form" onSubmit={sendMessage}>
          <input
            type="text"
            value={inputMessage}
            onChange={handleInputChange}
            placeholder={isConnected ? "Type a message..." : "Connecting..."}
          />
          <button type="submit" disabled={!inputMessage.trim()}>Send</button>
        </form>
      </div>
    </div>
  );
}

export default App;
