let stopIdCounter = 0;

export function newStopId() {
  return ++stopIdCounter;
}

// Shared add/remove/update handlers for a stops array (each entry
// {id, selection}, selection null until the AddressAutocomplete resolves a
// real address) - used by every booking form that supports multiple stops
// (passenger booking/edit, driver book-for-passenger).
export function makeStopHandlers(setStopsState) {
  return {
    add: () => setStopsState((s) => [...s, { id: newStopId(), selection: null }]),
    remove: (id) => setStopsState((s) => s.filter((stop) => stop.id !== id)),
    update: (id, selection) => setStopsState((s) => s.map((stop) => (stop.id === id ? { ...stop, selection } : stop))),
  };
}

// stops with a resolved address, in the {address, lat, lng} shape the
// backend expects (see backend/utils/distance.js cleanStops()).
export function stopsPayload(stopsState) {
  return stopsState.filter((s) => s.selection).map((s) => ({ address: s.selection.label, lat: s.selection.lat, lng: s.selection.lng }));
}
