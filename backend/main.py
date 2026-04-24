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

# FastAPI App
app = FastAPI()

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
    try:
        while True:
            data = await websocket.receive_json()
            
            if data["type"] == "join":
                manager.users = [u for u in manager.users if u["username"] != data["username"]]
                manager.users.append({
                    "username": data["username"],
                    "avatar": data["avatar"],
                    "ws": websocket
                })
                await manager.update_user_list()
            
            elif data["type"] == "message":
                await manager.broadcast(data)
                
            elif data["type"] == "profile_update":
                for u in manager.users:
                    if u["username"] == data["username"]:
                        u["avatar"] = data["avatar"]
                await manager.update_user_list()
                
    except WebSocketDisconnect:
        manager.disconnect(websocket)
        await manager.update_user_list()
