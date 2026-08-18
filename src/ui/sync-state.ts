export interface UiSyncState {
  connectionEpoch: number;
  renderRevision: number;
}

export interface RevisionStart<T> {
  state: UiSyncState;
  revision: number;
  value: T;
}

export const initialUiSyncState: UiSyncState = {
  connectionEpoch: 0,
  renderRevision: 0,
};

export function beginConnection(state: UiSyncState): RevisionStart<number> {
  const connectionEpoch = state.connectionEpoch + 1;
  return {
    state: {
      connectionEpoch,
      renderRevision: state.renderRevision + 1,
    },
    revision: state.renderRevision + 1,
    value: connectionEpoch,
  };
}

export function beginRender(state: UiSyncState): RevisionStart<number> {
  const renderRevision = state.renderRevision + 1;
  return {
    state: {
      ...state,
      renderRevision,
    },
    revision: renderRevision,
    value: renderRevision,
  };
}

export function isCurrentConnection(
  state: UiSyncState,
  connectionEpoch: number,
): boolean {
  return state.connectionEpoch === connectionEpoch;
}

export function isCurrentRender(
  state: UiSyncState,
  renderRevision: number,
): boolean {
  return state.renderRevision === renderRevision;
}
