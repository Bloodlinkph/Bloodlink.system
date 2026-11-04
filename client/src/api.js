    import axios from "axios";

    // Where the token lives for this browser tab (cleared on logout or when the tab closes).
    export const TOKEN_KEY = "bloodlink:token";

    const api = axios.create({
    baseURL: import.meta.env.VITE_API_URL || "http://localhost:5000",
    headers: { "Content-Type": "application/json" },
    });

    // send the login token with every request
    api.interceptors.request.use((config) => {
    const token = sessionStorage.getItem(TOKEN_KEY);
    if (token) config.headers.Authorization = `Bearer ${token}`;
    return config;
    });

    // an expired token or a disabled account: tell the app to log out
    // (a wrong password on /login also answers 401, so that one is left alone)
    api.interceptors.response.use(
    (res) => res,
    (err) => {
        const url = err.config?.url || "";
        if (err.response?.status === 401 && !url.endsWith("/login")) {
        sessionStorage.removeItem(TOKEN_KEY);
        window.dispatchEvent(new Event("bloodlink:unauthorized"));
        }
        return Promise.reject(err);
    }
    );

    export default api;