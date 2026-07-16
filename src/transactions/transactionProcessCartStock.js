/**
 * Transaction process graph for the shopping cart's per-listing stock reservation:
 *   - cart-stock-process
 *
 * This is a child process: one instance is created per cart listing whenever a customer
 * checks out a cart (or a single "buy now" order, which is a cart of one). It exists only
 * to reserve/confirm/release stock for its one listing; the actual payment and order
 * lifecycle live on the parent transaction (default-purchase). Customers and providers
 * never see these transactions directly - there are no notifications, and this process
 * is deliberately excluded from getSupportedProcessesInfo() (see transaction.js) so it's
 * kept out of the inbox and other "known processes" listings.
 */

export const transitions = {
  // The customer's client creates one of these per cart listing, right after the parent
  // transaction's request-payment succeeds. Reserves stock (pending, not yet committed).
  REQUEST_STOCK_RESERVATION: 'transition/request-stock-reservation',

  // Once the parent transaction's payment is confirmed, the client confirms every child
  // to commit the stock reservation.
  CONFIRM_STOCK_RESERVATION: 'transition/confirm-stock-reservation',

  // If the reservation is never confirmed (payment failed/abandoned), it releases the
  // stock automatically. Kept longer than the parent's own payment-expiry window so a
  // child can never expire before its parent's payment attempt is resolved.
  EXPIRE_STOCK_RESERVATION: 'transition/expire-stock-reservation',

  // An operator can release a confirmed reservation's stock manually (e.g. to correct a
  // stock discrepancy after a parent-transaction cancellation).
  OPERATOR_CANCEL_STOCK_RESERVATION: 'transition/operator-cancel-stock-reservation',

  // Once a reservation has served its purpose, it's marked complete - by an operator, or
  // automatically after a long backstop window.
  OPERATOR_COMPLETE: 'transition/operator-complete',
  AUTO_COMPLETE: 'transition/auto-complete',
};

export const states = {
  INITIAL: 'initial',
  PENDING: 'pending',
  RESERVED: 'reserved',
  EXPIRED: 'expired',
  CANCELED: 'canceled',
  COMPLETED: 'completed',
};

export const graph = {
  id: 'cart-stock-process/release-1',
  initial: states.INITIAL,
  states: {
    [states.INITIAL]: {
      on: {
        [transitions.REQUEST_STOCK_RESERVATION]: states.PENDING,
      },
    },
    [states.PENDING]: {
      on: {
        [transitions.CONFIRM_STOCK_RESERVATION]: states.RESERVED,
        [transitions.EXPIRE_STOCK_RESERVATION]: states.EXPIRED,
      },
    },
    [states.EXPIRED]: {},
    [states.RESERVED]: {
      on: {
        [transitions.OPERATOR_CANCEL_STOCK_RESERVATION]: states.CANCELED,
        [transitions.OPERATOR_COMPLETE]: states.COMPLETED,
        [transitions.AUTO_COMPLETE]: states.COMPLETED,
      },
    },
    [states.CANCELED]: {},
    [states.COMPLETED]: { type: 'final' },
  },
};

// This process has no user-facing transaction page, so nothing is ever "relevant past
// history" to show.
export const isRelevantPastTransition = () => false;

export const isCustomerReview = () => false;

export const isProviderReview = () => false;

// Children are never initiated/transitioned through this app's privileged server
// endpoints - the client uses the plain (non-trusted) SDK directly for all of them.
export const isPrivileged = () => false;

export const isCompleted = transition => {
  return [transitions.OPERATOR_COMPLETE, transitions.AUTO_COMPLETE].includes(transition);
};

// No payment ever happens on this process, so nothing is ever refunded.
export const isRefunded = () => false;

export const statesNeedingProviderAttention = [];
