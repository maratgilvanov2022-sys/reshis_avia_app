let routesMap = new Map();

function getToken() {
    return localStorage.getItem("avia_token");
}

function setToken(token) {
    localStorage.setItem("avia_token", token);
}

function clearToken() {
    localStorage.removeItem("avia_token");
}

document.addEventListener("DOMContentLoaded", async () => {
    setupAuthTabs();
    setupAuthForms();
    setupForecastForm();

    const token = getToken();
    if (token) {
        try {
            const res = await fetch("/api/me", {
                headers: { "Authorization": "Bearer " + token }
            });
            if (res.ok) {
                const user = await res.json();
                await enterApp(user);
                return;
            }
        } catch (e) {
            console.error(e);
        }
        clearToken();
    }
    showAuthScreen();
});

function setupAuthTabs() {
    const tabLogin = document.getElementById("tab-login");
    const tabRegister = document.getElementById("tab-register");
    const loginForm = document.getElementById("login-form");
    const registerForm = document.getElementById("register-form");

    tabLogin.addEventListener("click", () => {
        tabLogin.classList.add("active");
        tabRegister.classList.remove("active");
        loginForm.classList.remove("hidden");
        registerForm.classList.add("hidden");
        hideAuthError();
    });

    tabRegister.addEventListener("click", () => {
        tabRegister.classList.add("active");
        tabLogin.classList.remove("active");
        registerForm.classList.remove("hidden");
        loginForm.classList.add("hidden");
        hideAuthError();
    });
}

function setupAuthForms() {
    document.getElementById("login-form").addEventListener("submit", async (e) => {
        e.preventDefault();
        hideAuthError();

        const payload = {
            username: document.getElementById("login-username").value,
            password: document.getElementById("login-password").value
        };

        try {
            const res = await fetch("/api/login", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload)
            });
            const data = await res.json();
            if (!res.ok) {
                throw new Error(data.detail || "Ошибка входа");
            }
            setToken(data.token);
            await enterApp(data);
        } catch (err) {
            showAuthError(err.message);
        }
    });

    document.getElementById("register-form").addEventListener("submit", async (e) => {
        e.preventDefault();
        hideAuthError();

        const payload = {
            full_name: document.getElementById("reg-fullname").value,
            username: document.getElementById("reg-username").value,
            password: document.getElementById("reg-password").value
        };

        try {
            const res = await fetch("/api/register", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload)
            });
            const data = await res.json();
            if (!res.ok) {
                throw new Error(data.detail || "Ошибка регистрации");
            }
            setToken(data.token);
            await enterApp(data);
        } catch (err) {
            showAuthError(err.message);
        }
    });

    document.getElementById("logout-btn").addEventListener("click", async () => {
        const token = getToken();
        if (token) {
            await fetch("/api/logout", {
                method: "POST",
                headers: { "Authorization": "Bearer " + token }
            }).catch(() => {});
        }
        clearToken();
        document.getElementById("results-section").classList.add("hidden");
        showAuthScreen();
    });
}

function showAuthScreen() {
    document.getElementById("auth-section").classList.remove("hidden");
    document.getElementById("app-section").classList.add("hidden");
    document.getElementById("user-panel").classList.add("hidden");
}

async function enterApp(user) {
    document.getElementById("auth-section").classList.add("hidden");
    document.getElementById("app-section").classList.remove("hidden");
    document.getElementById("user-panel").classList.remove("hidden");
    document.getElementById("user-greeting").textContent = "Сотрудник: " + user.full_name;

    await loadOptions();
}

async function loadOptions() {
    const originSelect = document.getElementById("origin-select");
    const destinationSelect = document.getElementById("destination-select");
    const dateInput = document.getElementById("date-input");

    try {
        const res = await fetch("/api/options", {
            headers: { "Authorization": "Bearer " + getToken() }
        });
        if (!res.ok) {
            throw new Error("Ошибка загрузки справочников");
        }
        const data = await res.json();

        const originsMap = new Map();
        const destinationsMap = new Map();

        data.routes.forEach((route) => {
            routesMap.set(route.code, route);

            const codes = route.code.split("-");
            const names = route.name.split(" — ");

            const originCode = codes.at(0);
            const destCode = codes.at(1);
            const originName = names.at(0) || originCode;
            const destName = names.at(1) || destCode;

            originsMap.set(originCode, originName);
            destinationsMap.set(destCode, destName);
        });

        originSelect.innerHTML = "";
        originsMap.forEach((name, code) => {
            const option = document.createElement("option");
            option.value = code;
            option.textContent = name + " (" + code + ")";
            originSelect.appendChild(option);
        });

        destinationSelect.innerHTML = "";
        destinationsMap.forEach((name, code) => {
            const option = document.createElement("option");
            option.value = code;
            option.textContent = name + " (" + code + ")";
            destinationSelect.appendChild(option);
        });

        updateSelectedRoute();

        if (data.dates && data.dates.length > 0) {
            const firstDate = data.dates.at(0);
            const lastDate = data.dates.at(-1);
            dateInput.min = firstDate;
            dateInput.max = lastDate;
            dateInput.value = firstDate;
        }
    } catch (err) {
        showError(err.message);
    }
}


function getSelectedRoute() {
    const originCode = document.getElementById("origin-select").value;
    const destCode = document.getElementById("destination-select").value;
    const routeCode = originCode + "-" + destCode;
    return routesMap.get(routeCode);
}

function updateSelectedRoute() {
    const priceInput = document.getElementById("price-input");
    const priceHint = document.getElementById("price-hint");
    const route = getSelectedRoute();

    if (route) {
        hideError();
        priceInput.value = route.base_price;
        priceHint.textContent = "Маршрут: " + route.name + " • Базовая цена: " + route.base_price + " ₽ (диапазон: " + route.price_min + " – " + route.price_max + " ₽)";
    } else {
        priceHint.textContent = "Для выбранной комбинации городов нет прямого рейса.";
    }
}

function setupForecastForm() {
    const originSelect = document.getElementById("origin-select");
    const destinationSelect = document.getElementById("destination-select");
    const dateInput = document.getElementById("date-input");
    const priceInput = document.getElementById("price-input");

    originSelect.addEventListener("change", updateSelectedRoute);
    destinationSelect.addEventListener("change", updateSelectedRoute);

    document.getElementById("forecast-form").addEventListener("submit", async (e) => {
        e.preventDefault();
        hideError();

        const selectedRoute = getSelectedRoute();
        if (!selectedRoute) {
            showError("Рейс по выбранному направлению отсутствует в расписании.");
            return;
        }

        const payload = {
            route: selectedRoute.code,
            date: dateInput.value,
            price: parseFloat(priceInput.value)
        };

        try {
            const response = await fetch("/api/predict", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": "Bearer " + getToken()
                },
                body: JSON.stringify(payload)
            });

            if (response.status === 401) {
                clearToken();
                showAuthScreen();
                return;
            }

            if (!response.ok) {
                const errData = await response.json();
                throw new Error(errData.detail || "Ошибка расчёта");
            }

            const result = await response.json();
            renderResults(result);
        } catch (err) {
            showError(err.message);
        }
    });
}


function renderResults(data) {
    const resultsSection = document.getElementById("results-section");
    resultsSection.classList.remove("hidden");

    document.getElementById("result-title").textContent = 
        "Прогноз: " + data.route_name + " на " + data.date + " (цена " + data.price + " ₽)";

    document.getElementById("seats-value").textContent = data.seats;
    document.getElementById("demand-value").textContent = Math.round(data.median_demand);
    document.getElementById("sales-value").textContent = Math.round(data.predicted_sales);

    const capacityAlert = document.getElementById("capacity-alert");
    if (data.median_demand > data.seats) {
        capacityAlert.textContent = "Внимание: желающих (" + Math.round(data.median_demand) + ") больше, чем мест в самолёте (" + data.seats + "). Продажи ограничены вместимостью борта.";
		        capacityAlert.classList.remove("hidden");
    } else if (data.median_demand < 0) {
        capacityAlert.textContent = "Внимание: при такой высокой цене спрос упал до нуля.";
        capacityAlert.classList.remove("hidden");
    } else {
        capacityAlert.classList.add("hidden");
    }

    renderChart(data.quantiles, data.seats);
}

function renderChart(quantiles, seats) {
    const canvas = document.getElementById("demandChart");
    const container = canvas.parentElement;
    
    const dpr = window.devicePixelRatio || 1;
    const width = (container.clientWidth - 32) || 720;
    const height = 280;
    
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = width + "px";
    canvas.style.height = height + "px";

    const ctx = canvas.getContext("2d");
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, width, height);

    const padLeft = 50;
    const padRight = 25;
    const padTop = 35;
    const padBottom = 40;
    const chartW = width - padLeft - padRight;
    const chartH = height - padTop - padBottom;

    let maxDemand = seats;
    quantiles.forEach(q => {
        if (q.demand > maxDemand) {
            maxDemand = q.demand;
        }
    });
    const yMax = Math.ceil((maxDemand * 1.15) / 50) * 50 || 100;

    ctx.strokeStyle = "#334155";
    ctx.fillStyle = "#94a3b8";
    ctx.font = "12px sans-serif";
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";

    const steps = 5;
    for (let i = 0; i <= steps; i++) {
        const val = Math.round((yMax / steps) * i);
        const y = padTop + chartH - (val / yMax) * chartH;

        ctx.beginPath();
        ctx.moveTo(padLeft, y);
        ctx.lineTo(padLeft + chartW, y);
        ctx.stroke();

        ctx.fillText(val.toString(), padLeft - 8, y);
    }

    const count = quantiles.length;
    const slotW = chartW / count;
    const barW = Math.min(44, slotW * 0.6);

    quantiles.forEach((q, idx) => {
        const val = Math.max(0, q.demand);
        const barH = (val / yMax) * chartH;
        const x = padLeft + idx * slotW + (slotW - barW) / 2;
        const y = padTop + chartH - barH;

        ctx.fillStyle = q.quantile === "0.5" ? "#6366f1" : "rgba(99, 102, 241, 0.35)";
        ctx.fillRect(x, y, barW, barH);

        ctx.fillStyle = "#f8fafc";
        ctx.font = q.quantile === "0.5" ? "bold 12px sans-serif" : "11px sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "bottom";
        ctx.fillText(Math.round(val).toString(), x + barW / 2, y - 5);

        ctx.fillStyle = q.quantile === "0.5" ? "#a5b4fc" : "#94a3b8";
        ctx.textBaseline = "top";
        ctx.fillText(q.quantile, x + barW / 2, padTop + chartH + 8);
    });

    const seatsY = padTop + chartH - (seats / yMax) * chartH;
    ctx.save();
    ctx.strokeStyle = "#f43f5e";
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(padLeft, seatsY);
    ctx.lineTo(padLeft + chartW, seatsY);
    ctx.stroke();

    ctx.fillStyle = "#fda4af";
    ctx.font = "bold 12px sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "bottom";
    ctx.fillText("Вместимость самолёта: " + seats + " мест", padLeft + 6, seatsY - 6);
    ctx.restore();
}

function showAuthError(msg) {
    const errDiv = document.getElementById("auth-error");
    errDiv.textContent = msg;
    errDiv.classList.remove("hidden");
}

function hideAuthError() {
    document.getElementById("auth-error").classList.add("hidden");
}

function showError(msg) {
    const errDiv = document.getElementById("error-message");
    errDiv.textContent = msg;
    errDiv.classList.remove("hidden");
}

function hideError() {
    document.getElementById("error-message").classList.add("hidden");
}
