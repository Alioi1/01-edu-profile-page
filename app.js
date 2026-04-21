const API_SIGNIN  = 'https://01yessenov.yu.edu.kz/api/auth/signin';
const API_GRAPHQL = 'https://01yessenov.yu.edu.kz/api/graphql-engine/v1/graphql';

function toBase64(str) {
    return btoa(unescape(encodeURIComponent(str)));
}

async function handleLogin() {
    const username = document.getElementById('inp-user').value.trim();
    const password = document.getElementById('inp-pass').value;
    const btn = document.getElementById('btn-login');

    if (!username || !password) {
        showError('Введи логин/email и пароль');
        return;
    }

    btn.disabled = true;
    btn.textContent = 'Подключаемся…';
    hideError();

    try {
        const credentials = toBase64(`${username}:${password}`);

        const response = await fetch(API_SIGNIN, {
            method: 'POST',
            headers: {
                'Authorization': `Basic ${credentials}`,
                'Content-Type': 'application/json'
            }
        });

        if (!response.ok) {
            throw new Error('Неверный логин или пароль (HTTP ' + response.status + ')');
        }

        const raw = await response.text();
        let jwt;
        try {
            const parsed = JSON.parse(raw);
            jwt = (typeof parsed === 'string') ? parsed : (parsed.token || raw);
        } catch {
            jwt = raw.trim().replace(/^"|"$/g, '');
        }

        localStorage.setItem('jwt', jwt);
        showProfile();

    } catch (err) {
        showError(err.message);
    } finally {
        btn.disabled = false;
        btn.textContent = 'Войти';
    }
}

function logout() {
    localStorage.removeItem('jwt');
    document.getElementById('profile-page').style.display = 'none';
    document.getElementById('login-page').style.display  = 'flex';
}

function showError(msg) {
    const el = document.getElementById('error-box');
    el.textContent = '✗ ' + msg;
    el.style.display = 'block';
}

function hideError() {
    document.getElementById('error-box').style.display = 'none';
}

async function gql(query, variables = {}) {
    const jwt = localStorage.getItem('jwt');

    const res = await fetch(API_GRAPHQL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${jwt}`
        },
        body: JSON.stringify({ query, variables })
    });

    const json = await res.json();

    if (json.errors) {
        const msg = json.errors[0].message;
        if (msg.includes('JWTExpired') || msg.includes('invalid')) {
            setTimeout(logout, 1500);
        }
        throw new Error(msg);
    }

    return json.data;
}

const QUERY_MAIN = `
{
    user {
        id
        login
        auditRatio
        totalUp
        totalDown
    }
    transaction(
        where: { type: { _eq: "xp" } }
        order_by: { createdAt: asc }
    ) {
        amount
        createdAt
        path
        object {
            name
            type
        }
    }
}
`;

async function loadProfile() {
    try {
        const data = await gql(QUERY_MAIN);
        const user         = data.user[0];
        const transactions = data.transaction || [];
        renderProfile(user, transactions);
    } catch (err) {
        document.getElementById('profile-content').innerHTML =
            `<div class="loading-state">⚠ Ошибка: ${err.message}</div>`;
    }
}

function renderProfile(user, transactions) {
    const totalXP = transactions.reduce((sum, t) => sum + (t.amount || 0), 0);

    function fmtXP(n) {
        if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + ' MB';
        if (n >= 1_000)     return (n / 1_000).toFixed(1) + ' kB';
        return n + ' B';
    }

    const ratio = user.auditRatio || 0;
    const ratioColor = ratio >= 1 ? 'var(--accent)' : 'var(--danger)';
    const upMB   = user.totalUp   ? (user.totalUp   / 1_000_000).toFixed(2) : '0';
    const downMB = user.totalDown ? (user.totalDown / 1_000_000).toFixed(2) : '0';

    document.getElementById('profile-content').innerHTML = `
        <div class="stats-grid">
            <div class="stat-card">
                <div class="stat-label">// user</div>
                <div class="stat-value" style="font-size:22px;word-break:break-all">${user.login}</div>
                <div class="stat-sub">id: ${user.id}</div>
            </div>
            <div class="stat-card">
                <div class="stat-label">// total xp</div>
                <div class="stat-value">${fmtXP(totalXP)}</div>
                <div class="stat-sub">${totalXP.toLocaleString('ru-RU')} bytes</div>
            </div>
            <div class="stat-card">
                <div class="stat-label">// audit ratio</div>
                <div class="stat-value" style="color:${ratioColor}">${ratio.toFixed(2)}</div>
                <div class="stat-sub">${ratio >= 1 ? '✓ хороший аудитор' : '✗ нужно больше аудитов'}</div>
            </div>
            <div class="stat-card">
                <div class="stat-label">// audits done / received</div>
                <div class="stat-value" style="font-size:18px">
                    ${upMB} <span style="color:var(--text-dim);font-size:14px">↑</span>
                    &nbsp;
                    ${downMB} <span style="color:var(--text-dim);font-size:14px">↓</span>
                </div>
                <div class="stat-sub">MB reviewed / MB to review</div>
            </div>
        </div>
        <p class="section-title">// statistics</p>
        <div class="charts-grid">
            <div class="chart-card">
                <div class="chart-title">Рост XP со временем</div>
                ${buildLineChart(transactions)}
            </div>
            <div class="chart-card">
                <div class="chart-title">Аудит: сделано vs получено</div>
                ${buildAuditChart(user.totalUp || 0, user.totalDown || 0, ratio)}
            </div>
        </div>
    `;
}

function buildLineChart(transactions) {
    if (!transactions || transactions.length === 0) {
        return '<p style="color:var(--text-dim);font-size:13px">Нет данных</p>';
    }

    let pts = transactions;
    if (pts.length > 150) {
        const step = Math.ceil(pts.length / 150);
        pts = pts.filter((_, i) => i % step === 0 || i === pts.length - 1);
    }

    let cum = 0;
    const cumPoints = pts.map((t, i) => {
        cum += t.amount || 0;
        return { xp: cum, i };
    });

    const n = cumPoints.length;
    const maxXP = cumPoints[n - 1].xp;
    const W = 560, H = 240;
    const PAD_L = 48, PAD_R = 16, PAD_T = 16, PAD_B = 30;
    const cW = W - PAD_L - PAD_R;
    const cH = H - PAD_T - PAD_B;

    const sx = (i)  => PAD_L + (i / Math.max(n - 1, 1)) * cW;
    const sy = (xp) => PAD_T + (1 - xp / maxXP) * cH;

    const linePath = cumPoints
        .map((p, i) => `${i === 0 ? 'M' : 'L'}${sx(p.i).toFixed(1)},${sy(p.xp).toFixed(1)}`)
        .join(' ');

    const fillPath = linePath + ` L${sx(n - 1).toFixed(1)},${(PAD_T + cH).toFixed(1)} L${PAD_L},${(PAD_T + cH).toFixed(1)} Z`;

    function fmtY(n) {
        if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
        if (n >= 1_000)     return (n / 1_000).toFixed(0) + 'k';
        return '' + n;
    }

    const xLabels = [0, Math.floor(n*0.33), Math.floor(n*0.66), n-1]
        .filter((v, i, a) => a.indexOf(v) === i && v < n)
        .map(idx => {
            const date = new Date(pts[idx].createdAt);
            const label = `${date.getDate()}.${String(date.getMonth()+1).padStart(2,'0')}.${String(date.getFullYear()).slice(2)}`;
            return `<text x="${sx(idx).toFixed(1)}" y="${H - 6}" text-anchor="middle" fill="#3d4a70" font-size="9" font-family="JetBrains Mono, monospace">${label}</text>`;
        });

    return `
    <svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">
        <defs>
            <linearGradient id="grad1" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stop-color="#4f8ef7" stop-opacity="0.35"/>
                <stop offset="100%" stop-color="#4f8ef7" stop-opacity="0"/>
            </linearGradient>
        </defs>
        ${[0, 0.25, 0.5, 0.75, 1].map(r => {
            const y = (PAD_T + r * cH).toFixed(0);
            return `<line x1="${PAD_L}" y1="${y}" x2="${W - PAD_R}" y2="${y}" stroke="#1a2038" stroke-width="1"/>`;
        }).join('\n')}
        <line x1="${PAD_L}" y1="${PAD_T}" x2="${PAD_L}" y2="${PAD_T + cH}" stroke="#2a3255" stroke-width="1"/>
        <line x1="${PAD_L}" y1="${PAD_T + cH}" x2="${W - PAD_R}" y2="${PAD_T + cH}" stroke="#2a3255" stroke-width="1"/>
        <path d="${fillPath}" fill="url(#grad1)"/>
        <path d="${linePath}" fill="none" stroke="#4f8ef7" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
        <circle cx="${sx(n-1).toFixed(1)}" cy="${sy(maxXP).toFixed(1)}" r="4" fill="#4f8ef7" stroke="#080b14" stroke-width="2"/>
        <text x="${PAD_L - 6}" y="${(PAD_T + 4).toFixed(0)}" text-anchor="end" fill="#3d4a70" font-size="9" font-family="JetBrains Mono, monospace">${fmtY(maxXP)}</text>
        <text x="${PAD_L - 6}" y="${(PAD_T + cH * 0.5 + 4).toFixed(0)}" text-anchor="end" fill="#3d4a70" font-size="9" font-family="JetBrains Mono, monospace">${fmtY(Math.round(maxXP / 2))}</text>
        <text x="${PAD_L - 6}" y="${(PAD_T + cH).toFixed(0)}" text-anchor="end" fill="#3d4a70" font-size="9" font-family="JetBrains Mono, monospace">0</text>
        ${xLabels.join('\n')}
        <text x="${(sx(n-1) + 8).toFixed(1)}" y="${(sy(maxXP) + 4).toFixed(1)}" fill="#4f8ef7" font-size="10" font-family="JetBrains Mono, monospace" font-weight="bold">▲ ${fmtY(maxXP)}</text>
    </svg>`;
}

function buildAuditChart(totalUp, totalDown, ratio) {
    const W = 340, H = 220;
    const BAR_H    = 36;
    const MAX_BAR  = 240;
    const X_START  = 20;
    const Y1       = 50;
    const Y2       = 120;

    const maxVal   = Math.max(totalUp, totalDown, 1);
    const upW      = Math.max(4, (totalUp   / maxVal) * MAX_BAR);
    const downW    = Math.max(4, (totalDown / maxVal) * MAX_BAR);

    function fmtMB(n) {
        return (n / 1_000_000).toFixed(2) + ' MB';
    }

    const ratioGood  = ratio >= 1;
    const ratioColor = ratioGood ? '#00e5c5' : '#ff5370';
    const ratioNorm   = Math.min(ratio / 2, 1);
    const markerX     = X_START + ratioNorm * MAX_BAR;
    const scaleY      = 178;

    return `
    <svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">
        <text x="${X_START}" y="${Y1 - 10}" fill="#5a6485" font-size="10" font-family="JetBrains Mono, monospace">DONE ↑</text>
        <rect x="${X_START}" y="${Y1}" width="${MAX_BAR}" height="${BAR_H}" rx="6" fill="#1a2038"/>
        <rect x="${X_START}" y="${Y1}" width="${upW.toFixed(1)}" height="${BAR_H}" rx="6" fill="#4f8ef7"/>
        <text x="${X_START + MAX_BAR + 8}" y="${Y1 + BAR_H/2 + 4}" fill="#4f8ef7" font-size="11" font-family="JetBrains Mono, monospace">${fmtMB(totalUp)}</text>

        <text x="${X_START}" y="${Y2 - 10}" fill="#5a6485" font-size="10" font-family="JetBrains Mono, monospace">RECEIVED ↓</text>
        <rect x="${X_START}" y="${Y2}" width="${MAX_BAR}" height="${BAR_H}" rx="6" fill="#1a2038"/>
        <rect x="${X_START}" y="${Y2}" width="${downW.toFixed(1)}" height="${BAR_H}" rx="6" fill="#00e5c5" opacity="0.7"/>
        <text x="${X_START + MAX_BAR + 8}" y="${Y2 + BAR_H/2 + 4}" fill="#00e5c5" font-size="11" font-family="JetBrains Mono, monospace">${fmtMB(totalDown)}</text>

        <text x="${X_START}" y="${scaleY - 10}" fill="#5a6485" font-size="10" font-family="JetBrains Mono, monospace">AUDIT RATIO (0 ←→ 2.0+)</text>
        <rect x="${X_START}" y="${scaleY}" width="${MAX_BAR}" height="8" rx="4" fill="#1a2038"/>
        <rect x="${X_START}" y="${scaleY}" width="${(ratioNorm * MAX_BAR).toFixed(1)}" height="8" rx="4" fill="${ratioColor}"/>
        <line x1="${X_START + MAX_BAR/2}" y1="${scaleY - 4}" x2="${X_START + MAX_BAR/2}" y2="${scaleY + 12}" stroke="#2a3255" stroke-width="1.5" stroke-dasharray="2,2"/>
        <text x="${X_START + MAX_BAR/2}" y="${scaleY + 22}" text-anchor="middle" fill="#3d4a70" font-size="9" font-family="JetBrains Mono, monospace">1.0</text>
        <circle cx="${markerX.toFixed(1)}" cy="${scaleY + 4}" r="6" fill="${ratioColor}" stroke="#080b14" stroke-width="2"/>
        <text x="${W/2}" y="${H - 8}" text-anchor="middle" fill="${ratioColor}" font-size="28" font-family="Syne, sans-serif" font-weight="800">${ratio.toFixed(2)}</text>
        <text x="${W/2 + 52}" y="${H - 8}" fill="${ratioColor}" font-size="11" font-family="JetBrains Mono, monospace" opacity="0.7">${ratioGood ? '✓ ok' : '✗ low'}</text>
    </svg>`;
}

function showProfile() {
    document.getElementById('login-page').style.display   = 'none';
    document.getElementById('profile-page').style.display = 'block';
    loadProfile();
}

window.addEventListener('DOMContentLoaded', () => {
    const jwt = localStorage.getItem('jwt');
    if (jwt) {
        showProfile();
    }
    ['inp-user', 'inp-pass'].forEach(id => {
        document.getElementById(id).addEventListener('keydown', e => {
            if (e.key === 'Enter') handleLogin();
        });
    });
});