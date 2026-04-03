const { isAdminEmail } = require('../config/adminStore');

function isTruthy(value) {
  if (value === true) return true;
  const normalized = String(value || '').trim().toLowerCase();
  return normalized === 'true' || normalized === '1' || normalized === 'yes' || normalized === 'admin';
}

function userHasAdminFlag(user = {}) {
  return (
    isTruthy(user?.user_metadata?.isAdmin)
    || isTruthy(user?.user_metadata?.is_admin)
    || isTruthy(user?.app_metadata?.isAdmin)
    || isTruthy(user?.app_metadata?.is_admin)
    || String(user?.app_metadata?.role || '').trim().toLowerCase() === 'admin'
    || String(user?.user_metadata?.role || '').trim().toLowerCase() === 'admin'
  );
}

function canAccessAdmin(req) {
  if (!req?.user) {
    console.log('[DEBUG canAccessAdmin] NO USER FOUND - BLOCKING ACCESS');
    return false;
  }
  const expiresAt = req?.saasUser?.expiresAt ? new Date(req.saasUser.expiresAt).getTime() : 0;
  const access = req?.saasUser?.metadata?.access || {};
  const email = String(req.user.email || '').trim().toLowerCase();
  const hasLegacyAdminTrust = userHasAdminFlag(req.user) || isAdminEmail(email);
  const hasExplicitAdminGate = access?.allowAdmin === true;
  const hasExplicitAdminDeny = access?.allowAdmin === false;
  const hasImplicitLegacyAdminGate = !hasExplicitAdminDeny && hasLegacyAdminTrust;
  const hasAdminGate = hasExplicitAdminGate || hasImplicitLegacyAdminGate;
  
  // Comprehensive debug log
  console.log('\n[DEBUG canAccessAdmin] ===== ADMIN ACCESS CHECK =====', {
    email,
    hasExplicitAdminGate, // Did SaaS metadata explicitly grant admin?
    hasExplicitAdminDeny, // Did SaaS metadata explicitly deny admin?
    hasLegacyAdminTrust, // Is user in legacy admin list or has admin flags?
    hasImplicitLegacyAdminGate, // Legacy trust + not explicitly denied?
    hasAdminGate, // Final gate status
    userFlags: userHasAdminFlag(req.user),
    isAdminEmail: isAdminEmail(email),
    saasUserMetadata: req?.saasUser?.metadata,
    userMetadata: { user_metadata: req?.user?.user_metadata, app_metadata: req?.user?.app_metadata },
    tokenExpired: expiresAt > 0 && expiresAt <= Date.now(),
  });
  
  if (Number.isFinite(expiresAt) && expiresAt > 0 && expiresAt <= Date.now()) {
    console.log('[DEBUG canAccessAdmin] TOKEN EXPIRED - BLOCKING ACCESS');
    return false;
  }
  if (!hasAdminGate) {
    console.log('[DEBUG canAccessAdmin] NO ADMIN GATE FOUND - BLOCKING ACCESS');
    return false;
  }
  if (hasExplicitAdminGate) {
    console.log('[DEBUG canAccessAdmin] ALLOWED: Explicit SaaS allowAdmin=true');
    return true;
  }
  if (userHasAdminFlag(req.user)) {
    console.log('[DEBUG canAccessAdmin] ALLOWED: User has admin flag in metadata');
    return true;
  }
  if (isAdminEmail(email)) {
    console.log('[DEBUG canAccessAdmin] ALLOWED: Email in legacy admin list');
    return true;
  }
  console.log('[DEBUG canAccessAdmin] FALLTHROUGH - BLOCKING ACCESS');
  return false;
}

function requireAdminAccess(req, res, next) {
  console.log(`[DEBUG requireAdminAccess] Route: ${req.method} ${req.path}, User: ${req?.user?.email || 'UNKNOWN'}`);
  if (!canAccessAdmin(req)) {
    console.log(`[DEBUG requireAdminAccess] DENIED - User ${req?.user?.email || 'UNKNOWN'} blocked from ${req.path}`);
    return res.status(403).json({ msg: 'Admin access required.' });
  }
  console.log(`[DEBUG requireAdminAccess] ALLOWED - User ${req?.user?.email || 'UNKNOWN'} granted access to ${req.path}`);
  return next();
}

module.exports = {
  requireAdminAccess,
  canAccessAdmin,
};
