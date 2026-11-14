import hashlib
import os
import secrets
import sqlite3
from fastapi import FastAPI, HTTPException, Header, Depends
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel
import pandas as pd

app = FastAPI(title="Решись Авиа — Прогноз спроса")

DB_PATH = "users.db"

def init_db():
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            full_name TEXT NOT NULL,
            salt TEXT NOT NULL,
            password_hash TEXT NOT NULL
        )
    """)
    conn.commit()
    conn.close()

init_db()

active_sessions = {}

def hash_password(password: str, salt: bytes) -> str:
    dk = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, 100000)
    return dk.hex()


try:
    routes_df = pd.read_csv("data/routes.csv")
    forecast_df = pd.read_csv("data/Gilvanov_Marat_Rinatovich_my_forecast.csv")
except FileNotFoundError as e:
    raise RuntimeError(f"Ошибка загрузки файлов данных: {e}. Проверьте папку data/.")

routes_dict = routes_df.set_index("route").to_dict(orient="index")


class RegisterRequest(BaseModel):
    username: str
    full_name: str
    password: str

class LoginRequest(BaseModel):
    username: str
    password: str

class ForecastRequest(BaseModel):
    route: str
    date: str
    price: float


def get_current_user(authorization: str = Header(None)):
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Требуется авторизация")
    token = authorization.replace("Bearer ", "").strip()
    user = active_sessions.get(token)
    if not user:
        raise HTTPException(status_code=401, detail="Сессия истекла или недействительна")
    return user


@app.post("/api/register")
def register_user(req: RegisterRequest):
    username = req.username.strip().lower()
    full_name = req.full_name.strip()

    if len(username) < 3:
        raise HTTPException(status_code=400, detail="Логин должен содержать минимум 3 символа")
    if len(req.password) < 4:
        raise HTTPException(status_code=400, detail="Пароль должен содержать минимум 4 символа")
    if not full_name:
        raise HTTPException(status_code=400, detail="Укажите имя сотрудника")

    salt = os.urandom(16)
    pwd_hash = hash_password(req.password, salt)

    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    try:
        cursor.execute(
            "INSERT INTO users (username, full_name, salt, password_hash) VALUES (?, ?, ?, ?)",
            (username, full_name, salt.hex(), pwd_hash),
        )
        conn.commit()
    except sqlite3.IntegrityError:
        conn.close()
        raise HTTPException(status_code=400, detail="Пользователь с таким логином уже существует")
    conn.close()

    token = secrets.token_hex(24)
    active_sessions[token] = {"username": username, "full_name": full_name}
    return {"token": token, "username": username, "full_name": full_name}


@app.post("/api/login")
def login_user(req: LoginRequest):
    username = req.username.strip().lower()

    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute(
        "SELECT full_name, salt, password_hash FROM users WHERE username = ?",
        (username,),
    )
    row = cursor.fetchone()
    conn.close()

    if not row:
        raise HTTPException(status_code=401, detail="Неверный логин или пароль")

    full_name, salt_hex, stored_hash = row
    computed_hash = hash_password(req.password, bytes.fromhex(salt_hex))

    if computed_hash != stored_hash:
        raise HTTPException(status_code=401, detail="Неверный логин или пароль")

    token = secrets.token_hex(24)
    active_sessions[token] = {"username": username, "full_name": full_name}
    return {"token": token, "username": username, "full_name": full_name}


@app.post("/api/logout")
def logout_user(authorization: str = Header(None)):
    if authorization and authorization.startswith("Bearer "):
        token = authorization.replace("Bearer ", "").strip()
        active_sessions.pop(token, None)
    return {"status": "ok"}


@app.get("/api/me")
def check_me(user: dict = Depends(get_current_user)):
    return user


@app.get("/api/options")
def get_options(user: dict = Depends(get_current_user)):
    routes_list = []
    for _, row in routes_df.iterrows():
        routes_list.append({
            "code": row["route"],
            "name": row["name"],
            "base_price": float(row["base_price"]),
            "price_min": float(row["price_min"]),
            "price_max": float(row["price_max"]),
        })
    dates_list = sorted(forecast_df["date"].unique().tolist())
    return {"routes": routes_list, "dates": dates_list}


@app.post("/api/predict")
def predict_demand(req: ForecastRequest, user: dict = Depends(get_current_user)):
    if req.route not in routes_dict:
        raise HTTPException(status_code=404, detail="Маршрут не найден")

    flight = forecast_df[
        (forecast_df["route"] == req.route) & (forecast_df["date"] == req.date)
    ]

    if flight.empty:
        raise HTTPException(
            status_code=404, detail="Рейс на указанную дату не найден"
        )

    row = flight.to_dict(orient="records").pop(0)
    route_info = routes_dict[req.route]

    seats = int(row["seats"])
    base_price = float(route_info["base_price"])
    sensitivity = float(route_info["price_sensitivity"])

    quantiles_data = []
    median_raw_demand = 0.0
    median_sales = 0.0

    for i in range(1, 10):
        q_label = f"0.{i}"
        base_demand = float(row[f"{q_label}_base_demand"])
        raw_demand = base_demand - sensitivity * (req.price - base_price)
        capped_sales = min(float(seats), max(0.0, raw_demand))

        quantiles_data.append({
            "quantile": q_label,
            "demand": round(raw_demand, 1),
            "sales": round(capped_sales, 1),
        })

        if i == 5:
            median_raw_demand = round(raw_demand, 1)
            median_sales = round(capped_sales, 1)

    return {
        "route_name": route_info["name"],
        "date": req.date,
        "price": req.price,
        "base_price": base_price,
        "seats": seats,
        "median_demand": median_raw_demand,
        "predicted_sales": median_sales,
        "quantiles": quantiles_data,
    }


app.mount("/static", StaticFiles(directory="static"), name="static")


@app.get("/")
def serve_frontend():
    return FileResponse("static/index.html")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=True)
