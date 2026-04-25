from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Depends, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import Column, Integer, String, create_engine
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker, Session
from pydantic import BaseModel
from typing import List, Optional
import json
import bcrypt

# Database Setup
SQLALCHEMY_DATABASE_URL = "sqlite:///./chat.db"
engine = create_engine(SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

class UserDB(Base):
    __tablename__ = "users"
    id = Column(Integer, primary_key=True, index=True)
    username = Column(String, unique=True, index=True)
    password_hash = Column(String)
    avatar = Column(String)

class MessageDB(Base):
    __tablename__ = "messages"
    id = Column(Integer, primary_key=True, index=True)
    username = Column(String)
    text = Column(String)
    avatar = Column(String)
    timestamp = Column(String)

Base.metadata.create_all(bind=engine)

# Pydantic Models
class UserCreate(BaseModel):
    username: str
    password: str
    avatar: Optional[str] = None

class UserLogin(BaseModel):
    username: str
    password: str

class UserResponse(BaseModel):
    username: str
    avatar: str

from datetime import datetime

# ... (rest of code before FastAPI app)

# FastAPI App
app = FastAPI()

# Add Health Check Root
@app.get("/")
def read_root():
    return {"status": "ok", "message": "Chat Backend is running"}

@app.get("/messages")
def get_messages(db: Session = Depends(get_db)):
    messages = db.query(MessageDB).order_by(MessageDB.id.desc()).limit(50).all()
    # Reverse to get chronological order
    return [{"username": m.username, "text": m.text, "avatar": m.avatar, "timestamp": m.timestamp, "id": str(m.id)} for m in reversed(messages)]

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

# Helper functions for auth
def hash_password(password: str):
    salt = bcrypt.gensalt()
    return bcrypt.hashpw(password.encode('utf-8'), salt).decode('utf-8')

def verify_password(password: str, hashed_password: str):
    return bcrypt.checkpw(password.encode('utf-8'), hashed_password.encode('utf-8'))

# Auth Endpoints
@app.post("/register")
def register(user: UserCreate, db: Session = Depends(get_db)):
    db_user = db.query(UserDB).filter(UserDB.username == user.username).first()
    if db_user:
        raise HTTPException(status_code=400, detail="Username already registered")
    
    hashed_password = hash_password(user.password)
    new_user = UserDB(
        username=user.username, 
        password_hash=hashed_password,
        avatar=user.avatar or f"https://api.dicebear.com/7.x/avataaars/svg?seed={user.username}"
    )
    db.add(new_user)
    db.commit()
    return {"message": "User created successfully"}

@app.post("/login")
def login(user: UserLogin, db: Session = Depends(get_db)):
    db_user = db.query(UserDB).filter(UserDB.username == user.username).first()
    if not db_user or not verify_password(user.password, db_user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid username or password")
    
    return {
        "username": db_user.username,
        "avatar": db_user.avatar
    }

@app.put("/profile")
def update_profile(user_data: UserResponse, db: Session = Depends(get_db)):
    db_user = db.query(UserDB).filter(UserDB.username == user_data.username).first()
    if not db_user:
        raise HTTPException(status_code=404, detail="User not found")
    
    db_user.avatar = user_data.avatar
    db.commit()
    return {"message": "Profile updated", "avatar": db_user.avatar}

# WebSocket Logic
class ConnectionManager:
    def __init__(self):
        self.active_connections: List[WebSocket] = []
        self.users: List[dict] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)
        self.users = [u for u in self.users if u["ws"] != websocket]

    async def broadcast(self, message: dict):
        for connection in self.active_connections:
            try:
                await connection.send_json(message)
            except:
                continue

    async def update_user_list(self):
        user_data = [{"username": u["username"], "avatar": u["avatar"]} for u in self.users]
        await self.broadcast({"type": "user_list", "users": user_data})

manager = ConnectionManager()

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await manager.connect(websocket)
    db = SessionLocal() # Create db session for this connection
    print(f"Client connected: {websocket.client}")
    try:
        while True:
            try:
                data = await websocket.receive_json()
            except json.JSONDecodeError:
                print("Received invalid JSON")
                continue
            
            if data["type"] == "join":
                print(f"User joined: {data['username']}")
                manager.users = [u for u in manager.users if u["username"] != data["username"]]
                manager.users.append({
                    "username": data["username"],
                    "avatar": data["avatar"],
                    "ws": websocket
                })
                await manager.update_user_list()
            
            elif data["type"] == "message":
                print(f"Message from {data['username']}: {data['text']}")
                timestamp = datetime.now().strftime("%H:%M")
                
                # Save to database
                new_msg = MessageDB(
                    username=data["username"],
                    text=data["text"],
                    avatar=data["avatar"],
                    timestamp=timestamp
                )
                db.add(new_msg)
                db.commit()
                db.refresh(new_msg)

                # Add metadata for broadcast
                data["timestamp"] = timestamp
                data["id"] = str(new_msg.id)
                await manager.broadcast(data)
                
            elif data["type"] == "read_receipt":
                await manager.broadcast(data)
                
            elif data["type"] == "profile_update":
                print(f"Profile update for {data['username']}")
                for u in manager.users:
                    if u["username"] == data["username"]:
                        u["avatar"] = data["avatar"]
                await manager.update_user_list()
                
    except WebSocketDisconnect:
        print("Client disconnected")
    except Exception as e:
        print(f"Unexpected error: {e}")
    finally:
        db.close() # Ensure database session is closed
        manager.disconnect(websocket)
        await manager.update_user_list()
