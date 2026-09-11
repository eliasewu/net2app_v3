/**
 * Only SMPP connectors have a real bound/unbound connection state.
 * Every other connector type (HTTP API, Voice OTP, OTT, RCS, Android SMS, ...)
 * is always available, so it should show as bound/active whenever the entity
 * itself is enabled.
 */

const SMPP = 'smpp';

/** Whether a connection type is SMPP (the only type with a live bind state). */
export function isSmpp(connectionType?: string | null): boolean {
  return (connectionType || SMPP).toLowerCase() === SMPP;
}

/**
 * Resolve the effective "bound" state for a supplier/connector.
 * - SMPP: bound only when a real SMPP session is live (bind_status === 'bound').
 * - Everything else: always bound whenever the entity is active (enabled).
 */
export function connectorIsBound(
  connectionType: string | null | undefined,
  bindStatus: string | null | undefined,
  entityActive = true,
): boolean {
  return isSmpp(connectionType) ? bindStatus === 'bound' : entityActive;
}

/** A client is SMPP-based when it has SMPP credentials assigned; otherwise it is HTTP API / Voice OTP. */
export function clientIsSmpp(smppUsername?: string | null): boolean {
  return !!smppUsername;
}