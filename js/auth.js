import { API_BASE_URL } from './config.js';

document.addEventListener('DOMContentLoaded', () => {
    const loginForm = document.getElementById('login-form');
    const emailInput = document.getElementById('email');
    const passwordInput = document.getElementById('password');
    const loginBtn = document.getElementById('btn-login');
    const errorDiv = document.getElementById('login-error');

    // Check if already logged in
    checkSession();

    if (loginForm) {
        loginForm.addEventListener('submit', async (e) => {
            e.preventDefault();

            const email = emailInput.value;
            const password = passwordInput.value;

            setLoading(true);
            showError(''); // Clear error

            try {
                // Call our Backend Proxy instead of Supabase directly (Avoids CSP issues)
                const response = await fetch(`${API_BASE_URL}/api/auth/login`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ email, password })
                });

                const data = await response.json();

                if (!response.ok) {
                    throw new Error(data.error || 'Login failed');
                }

                if (data.session) {
                    console.log('[Auth] Login successful:', data.user.email);

                    // Save Session Token in LocalStorage (for API Client usage)
                    // We save it in extension storage so it persists across views
                    chrome.storage.local.set({
                        'supa_session': data.session,
                        'supa_user': data.user,
                        'ext_authenticated': true
                    }, () => {
                        window.location.href = 'dashboard.html';
                    });
                }
            } catch (err) {
                console.error('[Auth] Login failed:', err);
                showError(err.message === 'Invalid login credentials' ? 'Email ou senha incorretos.' : err.message);
            } finally {
                setLoading(false);
            }
        });
    }

    function setLoading(isLoading) {
        if (isLoading) {
            loginBtn.disabled = true;
            loginBtn.textContent = 'Entrando...';
        } else {
            loginBtn.disabled = false;
            loginBtn.textContent = 'Entrar';
        }
    }

    function showError(msg) {
        if (msg) {
            errorDiv.textContent = msg;
            errorDiv.style.display = 'block';
        } else {
            errorDiv.style.display = 'none';
        }
    }

    function checkSession() {
        chrome.storage.local.get(['supa_session', 'ext_authenticated'], (result) => {
            const hasSession = Boolean(result.ext_authenticated && result.supa_session && result.supa_session.access_token);
            if (hasSession) {
                window.location.href = 'dashboard.html';
            }
        });
    }
});

// Export for other modules
export const auth = {
    logout: () => {
        chrome.storage.local.clear(() => {
            window.location.href = 'login.html';
        });
    },
    getToken: () => {
        return new Promise(resolve => {
            chrome.storage.local.get(['supa_session'], (result) => {
                resolve(result.supa_session ? result.supa_session.access_token : null);
            });
        });
    }
};
