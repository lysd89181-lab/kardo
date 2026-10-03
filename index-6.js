// Firebase Cloud Functions for KARDO
// Deploy: firebase deploy --only functions

const functions = require('firebase-functions');
const admin = require('firebase-admin');

admin.initializeApp();
const db = admin.firestore();
const auth = admin.auth();

// ==================== CUSTOM CLAIMS ====================

/**
 * Promote user to admin with Custom Claims
 * Call: firebase functions:call setAdminRole --data "{\"uid\":\"USER_UID\"}"
 */
exports.setAdminRole = functions.https.onCall(async (data, context) => {
  // ✅ Verify caller is super admin
  if (!context.auth || !context.auth.token.admin) {
    throw new functions.https.HttpsError('permission-denied', 'Only admins can do this');
  }

  const { uid, role = 'super_admin' } = data;

  if (!uid) {
    throw new functions.https.HttpsError('invalid-argument', 'uid required');
  }

  try {
    // ✅ Set Custom Claims
    await auth.setCustomUserClaims(uid, {
      admin: true,
      role: role,  // 'super_admin' | 'finance' | 'support'
      promoted_at: new Date().toISOString()
    });

    // ✅ Create admins document
    await db.collection('admins').doc(uid).set({
      uid,
      email: (await auth.getUser(uid)).email,
      name: data.name || 'Admin',
      role,
      created_at: new Date(),
      promoted_by: context.auth.uid
    }, { merge: true });

    return {
      success: true,
      message: `User promoted to ${role}`,
      uid
    };
  } catch (error) {
    console.error('setAdminRole error:', error);
    throw new functions.https.HttpsError('internal', error.message);
  }
});

/**
 * Remove admin role
 */
exports.removeAdminRole = functions.https.onCall(async (data, context) => {
  if (!context.auth || !context.auth.token.admin) {
    throw new functions.https.HttpsError('permission-denied', 'Only admins can do this');
  }

  const { uid } = data;

  try {
    await auth.setCustomUserClaims(uid, null);  // Remove all claims
    await db.collection('admins').doc(uid).delete();

    return { success: true, message: 'Admin role removed', uid };
  } catch (error) {
    throw new functions.https.HttpsError('internal', error.message);
  }
});

// ==================== WALLET OPERATIONS ====================

/**
 * Atomic wallet transaction with Ledger
 * Creates transaction record + updates balance
 */
exports.executeWalletTransaction = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Must be authenticated');
  }

  const {
    uid = context.auth.uid,  // Allow admin to transact for user
    type,  // 'credit' or 'debit'
    amount,
    reason,
    reference,
    idempotencyKey
  } = data;

  // Only allow user to transact for self, or admin for anyone
  if (uid !== context.auth.uid && !context.auth.token.admin) {
    throw new functions.https.HttpsError('permission-denied', 'Cannot transact for others');
  }

  if (!['credit', 'debit'].includes(type)) {
    throw new functions.https.HttpsError('invalid-argument', 'type must be credit or debit');
  }

  if (amount <= 0 || amount > 10000) {
    throw new functions.https.HttpsError('invalid-argument', 'amount out of range (0, 10000)');
  }

  if (!reason || typeof reason !== 'string' || reason.length < 3) {
    throw new functions.https.HttpsError('invalid-argument', 'reason required (min 3 chars)');
  }

  try {
    // ✅ ATOMIC TRANSACTION
    return await db.runTransaction(async (transaction) => {
      const userRef = db.collection('users').doc(uid);
      const userSnap = await transaction.get(userRef);

      if (!userSnap.exists) {
        throw new functions.https.HttpsError('not-found', 'User not found');
      }

      const currentBalance = userSnap.get('wallet_balance') || 0;
      const newBalance = type === 'credit' 
        ? currentBalance + amount 
        : currentBalance - amount;

      if (type === 'debit' && newBalance < 0) {
        throw new functions.https.HttpsError('failed-precondition', 'Insufficient balance');
      }

      // ✅ Create immutable transaction record
      const txId = `tx_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const txRef = db.collection('wallet_transactions').doc(txId);

      transaction.set(txRef, {
        id: txId,
        uid,
        type,
        amount,
        reason,
        reference,
        timestamp: new Date(),
        idempotency_key: idempotencyKey,
        previous_balance: currentBalance,
        new_balance: newBalance
      });

      // ✅ Update user balance
      transaction.update(userRef, {
        wallet_balance: newBalance,
        last_transaction_at: new Date()
      });

      return {
        success: true,
        transaction_id: txId,
        previous_balance: currentBalance,
        new_balance: newBalance
      };
    });
  } catch (error) {
    console.error('executeWalletTransaction error:', error);
    if (error.code) throw error;  // Already HttpsError
    throw new functions.https.HttpsError('internal', error.message);
  }
});

/**
 * Get wallet balance (computed from ledger)
 */
exports.getWalletBalance = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Must be authenticated');
  }

  const uid = data.uid || context.auth.uid;

  // Only allow user to check self, or admin to check anyone
  if (uid !== context.auth.uid && !context.auth.token.admin) {
    throw new functions.https.HttpsError('permission-denied', 'Cannot check others balance');
  }

  try {
    const userSnap = await db.collection('users').doc(uid).get();
    const txSnap = await db.collection('wallet_transactions')
      .where('uid', '==', uid)
      .get();

    const storedBalance = userSnap.get('wallet_balance') || 0;
    const computedBalance = txSnap.docs.reduce((sum, doc) => {
      const type = doc.get('type');
      const amount = doc.get('amount');
      return type === 'credit' ? sum + amount : sum - amount;
    }, 0);

    // Log if mismatch
    if (Math.abs(storedBalance - computedBalance) > 0.01) {
      console.warn(`Balance mismatch for ${uid}: stored=${storedBalance}, computed=${computedBalance}`);
    }

    return {
      uid,
      wallet_balance: storedBalance,
      computed_balance: computedBalance,
      mismatch: Math.abs(storedBalance - computedBalance) > 0.01,
      transactions_count: txSnap.size
    };
  } catch (error) {
    throw new functions.https.HttpsError('internal', error.message);
  }
});

// ==================== CARD OPERATIONS ====================

/**
 * Create manual card order (called from Worker)
 * Deducts from wallet atomically
 */
exports.createCardOrder = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Must be authenticated');
  }

  const uid = context.auth.uid;
  const {
    kind,  // 'create' or 'topup'
    name_on_card,
    amount,
    card_label,
    idempotencyKey
  } = data;

  if (!['create', 'topup'].includes(kind)) {
    throw new functions.https.HttpsError('invalid-argument', 'kind must be create or topup');
  }

  if (amount < 10 || amount > 1000) {
    throw new functions.https.HttpsError('invalid-argument', 'amount must be 10-1000');
  }

  try {
    // ✅ Atomic: deduct + create order
    const result = await db.runTransaction(async (transaction) => {
      const userRef = db.collection('users').doc(uid);
      const userSnap = await transaction.get(userRef);

      const currentBalance = userSnap.get('wallet_balance') || 0;

      // Calculate fees
      const fee = kind === 'create'
        ? 8 + (amount * 0.025)
        : 2.5 + (amount * 0.025);

      const total = amount + fee;

      if (currentBalance < total) {
        throw new functions.https.HttpsError('failed-precondition', 'Insufficient balance');
      }

      // Deduct from wallet
      const newBalance = currentBalance - total;
      transaction.update(userRef, { wallet_balance: newBalance });

      // Create order
      const orderId = `order_${Date.now()}`;
      const orderRef = db.collection('manual_card_orders').doc(orderId);

      transaction.set(orderRef, {
        id: orderId,
        uid,
        kind,
        name_on_card: name_on_card.toUpperCase(),
        card_label,
        amount,
        fee,
        total,
        status: 'pending',
        created_at: new Date(),
        idempotency_key: idempotencyKey
      });

      // Log transaction
      const txId = `tx_${Date.now()}`;
      const txRef = db.collection('wallet_transactions').doc(txId);
      transaction.set(txRef, {
        id: txId,
        uid,
        type: 'debit',
        amount: total,
        reason: `Card ${kind}`,
        reference: orderId,
        timestamp: new Date(),
        previous_balance: currentBalance,
        new_balance: newBalance
      });

      return {
        success: true,
        order_id: orderId,
        amount,
        fee,
        total,
        new_balance: newBalance
      };
    });

    return result;
  } catch (error) {
    console.error('createCardOrder error:', error);
    if (error.code) throw error;
    throw new functions.https.HttpsError('internal', error.message);
  }
});

/**
 * Fulfill card order (admin only)
 * Creates manual_cards + temporary manual_card_reveal
 */
exports.fulfillCardOrder = functions.https.onCall(async (data, context) => {
  if (!context.auth || !context.auth.token.admin) {
    throw new functions.https.HttpsError('permission-denied', 'Admins only');
  }

  const {
    order_id,
    card_number,
    expiry,
    cvv
  } = data;

  // Validate card data
  if (!/^\d{16}$/.test(card_number)) {
    throw new functions.https.HttpsError('invalid-argument', 'Invalid card number');
  }
  if (!/^\d{2}\/\d{2}$/.test(expiry)) {
    throw new functions.https.HttpsError('invalid-argument', 'Invalid expiry (MM/YY)');
  }
  if (!/^\d{3}$/.test(cvv)) {
    throw new functions.https.HttpsError('invalid-argument', 'Invalid CVV');
  }

  try {
    return await db.runTransaction(async (transaction) => {
      const orderRef = db.collection('manual_card_orders').doc(order_id);
      const orderSnap = await transaction.get(orderRef);

      if (!orderSnap.exists) {
        throw new functions.https.HttpsError('not-found', 'Order not found');
      }

      if (orderSnap.get('status') !== 'pending') {
        throw new functions.https.HttpsError('failed-precondition', 'Order not pending');
      }

      // Mark order as completed
      transaction.update(orderRef, {
        status: 'completed',
        fulfilled_by: context.auth.uid,
        fulfilled_at: new Date()
      });

      // Create card record (no CVV)
      const cardId = `card_${Date.now()}`;
      const cardRef = db.collection('manual_cards').doc(cardId);

      transaction.set(cardRef, {
        id: cardId,
        uid: orderSnap.get('uid'),
        name_on_card: orderSnap.get('name_on_card'),
        expiry,
        order_id,
        created_at: new Date(),
        last_4: card_number.slice(-4)
      });

      // Create temporary reveal record (5 min expiry)
      const revealId = `reveal_${cardId}`;
      const revealRef = db.collection('manual_card_reveal').doc(revealId);
      const expiresAt = new Date(Date.now() + 5 * 60 * 1000);  // 5 minutes

      transaction.set(revealRef, {
        id: revealId,
        card_id: cardId,
        uid: orderSnap.get('uid'),
        card_number,
        cvv,
        expiry,
        created_at: new Date(),
        expires_at: expiresAt,
        ttl: 300  // 5 minutes in seconds
      });

      return {
        success: true,
        card_id: cardId,
        reveal_id: revealId,
        expires_at: expiresAt.toISOString(),
        ttl_seconds: 300
      };
    });
  } catch (error) {
    console.error('fulfillCardOrder error:', error);
    if (error.code) throw error;
    throw new functions.https.HttpsError('internal', error.message);
  }
});

// ==================== AUDIT LOGGING ====================

/**
 * Log settings changes for audit trail
 * Called whenever settings/main is updated
 */
exports.logSettingsAudit = functions.firestore
  .document('settings/main')
  .onUpdate(async (change, context) => {
    try {
      const before = change.before.data();
      const after = change.after.data();
      
      const changes = {};
      
      // Compare before and after
      for (const key in after) {
        if (before[key] !== after[key]) {
          changes[key] = {
            before: before[key],
            after: after[key]
          };
        }
      }
      
      // Log to audit collection
      await db.collection('audit_logs').add({
        type: 'settings_update',
        timestamp: new Date(),
        changes,
        ip: context.sourceIp || 'unknown'
      });
      
      console.log('Settings audit logged:', changes);
      return { success: true };
    } catch (error) {
      console.error('Audit logging error:', error);
      return { error: error.message };
    }
  });

// ==================== CLEANUP JOBS ====================

/**
 * Scheduled: Delete expired card reveal records
 * Deploy with: firebase deploy --only functions
 */
exports.cleanupExpiredReveals = functions.pubsub
  .schedule('every 5 minutes')
  .onRun(async (context) => {
    try {
      const now = new Date();
      const expiredSnap = await db.collection('manual_card_reveal')
        .where('expires_at', '<', now)
        .get();

      const batch = db.batch();
      expiredSnap.docs.forEach(doc => {
        batch.delete(doc.ref);
      });

      await batch.commit();
      console.log(`Cleaned up ${expiredSnap.size} expired card reveals`);

      return { deleted: expiredSnap.size };
    } catch (error) {
      console.error('cleanupExpiredReveals error:', error);
      return { error: error.message };
    }
  });

/**
 * Scheduled: Audit balance inconsistencies
 */
exports.auditBalances = functions.pubsub
  .schedule('every day 03:00')
  .timeZone('Africa/Tripoli')
  .onRun(async (context) => {
    try {
      const usersSnap = await db.collection('users').get();
      const mismatches = [];

      for (const userDoc of usersSnap.docs) {
        const uid = userDoc.id;
        const storedBalance = userDoc.get('wallet_balance') || 0;

        const txSnap = await db.collection('wallet_transactions')
          .where('uid', '==', uid)
          .get();

        const computedBalance = txSnap.docs.reduce((sum, doc) => {
          const type = doc.get('type');
          const amount = doc.get('amount');
          return type === 'credit' ? sum + amount : sum - amount;
        }, 0);

        if (Math.abs(storedBalance - computedBalance) > 0.01) {
          mismatches.push({
            uid,
            stored: storedBalance,
            computed: computedBalance,
            diff: storedBalance - computedBalance
          });
        }
      }

      if (mismatches.length > 0) {
        console.warn(`Balance audit found ${mismatches.length} mismatches:`, mismatches);
        // Send alert email to admin
      }

      return { checked: usersSnap.size, mismatches: mismatches.length };
    } catch (error) {
      console.error('auditBalances error:', error);
      return { error: error.message };
    }
  });

// ==================== USER LIFECYCLE ====================

/**
 * On user creation: initialize user document
 */
exports.initializeUserOnSignup = functions.auth.user().onCreate(async (user) => {
  try {
    await db.collection('users').doc(user.uid).set({
      uid: user.uid,
      email: user.email,
      display_name: user.displayName || 'User',
      wallet_balance: 0,
      created_at: new Date(),
      last_login: new Date(),
      banned: false,
      vip_status: null
    }, { merge: true });

    console.log(`User ${user.uid} initialized`);
    return { success: true };
  } catch (error) {
    console.error('initializeUserOnSignup error:', error);
  }
});

/**
 * On user deletion: clean up data
 */
exports.cleanupUserOnDelete = functions.auth.user().onDelete(async (user) => {
  try {
    const uid = user.uid;
    const batch = db.batch();

    // Delete user document
    batch.delete(db.collection('users').doc(uid));

    // Delete all orders
    const ordersSnap = await db.collection('manual_card_orders')
      .where('uid', '==', uid)
      .get();
    ordersSnap.docs.forEach(doc => batch.delete(doc.ref));

    // Delete all tickets
    const ticketsSnap = await db.collection('tickets')
      .where('uid', '==', uid)
      .get();
    ticketsSnap.docs.forEach(doc => batch.delete(doc.ref));

    await batch.commit();
    console.log(`User ${uid} cleaned up`);
    return { success: true };
  } catch (error) {
    console.error('cleanupUserOnDelete error:', error);
  }
});
