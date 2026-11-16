import "./loading.css";
import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

// whole Philippines: [south-west corner, north-east corner]
const PH_BOUNDS = [[4.2, 116.0], [21.5, 127.0]];
const PH_CENTER = [12.8797, 121.774];
const RED = "#c62828";

// Your own list of places (hospitals, blood banks, towns).
// These show first when you type in the search box.
// The coordinates below are APPROXIMATE examples only: replace them with the real ones.
// (The old "Baliuag District Hospital" template entry was removed: it is in Bulacan, not your area.)
// Add your own like this, with REAL coordinates:
// { name: "Hospital Name", area: "Town, Province", lat: 0.0, lng: 0.0 },
const PLACES = [];

// distance in km between two coordinates (computed locally)
const distKm = (aLat, aLng, bLat, bLng) => {
  const R = 6371;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
};

const keyOf = (la, ln) => `${la.toFixed(7)},${ln.toFixed(7)}`;

const prettyKind = (s) => (s ? String(s).replace(/_/g, " ") : "");

function LocationPicker({ latitude, longitude, onChange, onAddress, height = 380 }) {
  const containerRef = useRef(null);
  const overlayRef = useRef(null);
  const mapRef = useRef(null);
  const programmatic = useRef(false); // true while the code (not the user) is moving the map
  const lastEmitted = useRef(""); // last coordinates WE sent to the parent
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const onAddressRef = useRef(onAddress);
  onAddressRef.current = onAddress;
  const skipReverse = useRef(""); // coordinates whose address we already know
  const pickedQuery = useRef(""); // text we set ourselves after picking a result (don't search again for it)

  const [dragging, setDragging] = useState(false);
  const [query, setQuery] = useState("");
  const [showList, setShowList] = useState(false);
  const [msg, setMsg] = useState("");
  const [locating, setLocating] = useState(false);
  const [remote, setRemote] = useState([]);
  const [searching, setSearching] = useState(false);
  const [remoteMsg, setRemoteMsg] = useState("");

  const lat = parseFloat(latitude);
  const lng = parseFloat(longitude);
  const hasPin = !isNaN(lat) && !isNaN(lng);

  // tell the parent about a new pin position
  const emit = (la, ln) => {
    lastEmitted.current = keyOf(la, ln);
    onChangeRef.current(la.toFixed(7), ln.toFixed(7));
  };

  // move the map without triggering a new "user moved the map" update
  const go = (la, ln, zoom) => {
    const map = mapRef.current;
    if (!map) return;
    const c = map.getCenter();
    const z = zoom ?? map.getZoom();
    if (Math.abs(c.lat - la) < 1e-7 && Math.abs(c.lng - ln) < 1e-7 && map.getZoom() === z) return;
    programmatic.current = true;
    map.setView([la, ln], z, { animate: true });
  };

  // create the map once
  useEffect(() => {
    const map = L.map(containerRef.current, {
      zoomControl: false,
      minZoom: 5,
      maxBounds: PH_BOUNDS,
      maxBoundsViscosity: 1.0, // the map can't be dragged outside the Philippines
    }).setView(hasPin ? [lat, lng] : PH_CENTER, hasPin ? 17 : 5);

    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(map);
    L.control.zoom({ position: "bottomright" }).addTo(map);

    // keep clicks/scrolls on the search bar from moving the map
    if (overlayRef.current) {
      L.DomEvent.disableClickPropagation(overlayRef.current);
      L.DomEvent.disableScrollPropagation(overlayRef.current);
    }

    map.on("dragstart", () => { programmatic.current = false; });
    map.on("movestart", () => { if (!programmatic.current) setDragging(true); });
    map.on("moveend", () => {
      setDragging(false);
      if (programmatic.current) {
        programmatic.current = false;
        return;
      }
      const c = map.getCenter();
      emit(c.lat, c.lng);
    });

    mapRef.current = map;
    setTimeout(() => map.invalidateSize({ pan: false }), 0);
    return () => {
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // if lat/lng is changed from OUTSIDE (e.g. the "Use my current location" button under the map),
  // move the map there and zoom in
  useEffect(() => {
    if (!hasPin) {
      lastEmitted.current = "";
      return;
    }
    if (keyOf(lat, lng) === lastEmitted.current) return; // our own change (drag, search, locate)
    const map = mapRef.current;
    if (!map) return;
    go(lat, lng, Math.max(map.getZoom(), 17));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lat, lng, hasPin]);

  // auto-fill the address of the pinned spot (debounced; Nominatim reverse lookup: free, no API key)
  useEffect(() => {
    if (!hasPin || !onAddressRef.current) return;
    const key = keyOf(lat, lng);
    if (skipReverse.current === key) {
      skipReverse.current = "";
      return;
    }
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      try {
        const r = await fetch(
          `https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=18&accept-language=en&lat=${lat}&lon=${lng}`,
          { signal: ctrl.signal }
        );
        const d = await r.json();
        if (d.display_name) onAddressRef.current(d.display_name);
      } catch {
        /* ignore: the user can still type the location by hand */
      }
    }, 700);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [lat, lng, hasPin]);

  // local matches from the PLACES list (shown while typing)
  const q = query.trim().toLowerCase();
  const matches = q
    ? PLACES.filter((p) => `${p.name} ${p.area}`.toLowerCase().includes(q)).slice(0, 6)
    : [];

  // LIVE suggestions while typing (debounced; Photon = OpenStreetMap data, made for autocomplete)
  useEffect(() => {
    const text = query.trim();
    if (text.length < 2 || text === pickedQuery.current) {
      setRemote([]);
      setRemoteMsg("");
      setSearching(false);
      return;
    }
    const ctrl = new AbortController();
    setSearching(true);
    const t = setTimeout(async () => {
      try {
        const r = await fetch(
          `https://photon.komoot.io/api/?q=${encodeURIComponent(text)}&limit=8&lang=en&bbox=116.0,4.2,127.0,21.5`,
          { signal: ctrl.signal }
        );
        const d = await r.json();
        const items = (d.features || [])
          .filter((f) => f.properties.countrycode === "PH")
          .map((f) => {
            const p = f.properties;
            const parts = [p.name, p.street, p.district, p.city, p.county, p.state].filter(Boolean);
            return {
              place_id: `${p.osm_type}${p.osm_id}`,
              lat: f.geometry.coordinates[1],
              lon: f.geometry.coordinates[0],
              display_name: [...new Set(parts)].join(", "),
              kind: prettyKind(p.osm_value),
            };
          });
        setRemote(items);
        setRemoteMsg(items.length ? "" : "Walang nahanap. Subukan ang ibang spelling o ang bayan.");
        setSearching(false);
      } catch (e) {
        if (e.name !== "AbortError") {
          setRemoteMsg("Hindi ma-search ngayon. I-check ang internet.");
          setSearching(false);
        }
      }
    }, 350);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [query]);

  const pickPlace = (p) => {
    skipReverse.current = keyOf(p.lat, p.lng);
    go(p.lat, p.lng, 17);
    emit(p.lat, p.lng);
    if (onAddressRef.current) onAddressRef.current(`${p.name}, ${p.area}`);
    pickedQuery.current = p.name;
    setQuery(p.name);
    setRemote([]);
    setRemoteMsg("");
    setShowList(false);
    setMsg("");
  };

  const pickRemote = (item) => {
    const la = parseFloat(item.lat);
    const ln = parseFloat(item.lon);
    skipReverse.current = keyOf(la, ln);
    go(la, ln, 17);
    emit(la, ln);
    if (onAddressRef.current) onAddressRef.current(item.display_name);
    const shown = item.display_name.split(",").slice(0, 2).join(",");
    pickedQuery.current = shown.trim();
    setQuery(shown);
    setRemote([]);
    setRemoteMsg("");
    setShowList(false);
  };

  // Enter / Search button: pick the first suggestion
  const runSearch = () => {
    // empty search: say so right under the search box
    if (!query.trim()) {
      setMsg("Type a place to search.");
      return;
    }
    if (matches[0]) return pickPlace(matches[0]);
    if (remote[0]) return pickRemote(remote[0]);
    setShowList(true);
  };

  // find the user's current position (tries precise GPS first, then a faster rough fix)
  const locate = () => {
    if (!navigator.geolocation) {
      setMsg("Hindi supported ng browser mo ang location.");
      return;
    }
    setLocating(true);
    setMsg("");
    setShowList(false);

    const onFound = (pos) => {
      const la = pos.coords.latitude;
      const ln = pos.coords.longitude;
      go(la, ln, 17);
      emit(la, ln);
      setLocating(false);
    };
    const onFail = (err) => {
      setLocating(false);
      setMsg(
        err && err.code === 1
          ? "Naka-block ang location. Pindutin ang icon sa tabi ng address bar, i-allow ang Location, tapos i-refresh ang page."
          : "Hindi makuha ang location mo. I-on ang Location sa device mo, o i-drag ang mapa sa spot."
      );
    };

    navigator.geolocation.getCurrentPosition(
      onFound,
      (err) => {
        if (err && err.code === 1) return onFail(err); // permission denied: retrying won't help
        navigator.geolocation.getCurrentPosition(onFound, onFail, {
          enableHighAccuracy: false,
          timeout: 15000,
          maximumAge: 60000,
        });
      },
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 0 }
    );
  };

  const pinHere = () => {
    const c = mapRef.current.getCenter();
    emit(c.lat, c.lng);
  };

  // nearest saved place within 1 km of the pin (computed locally)
  let nearby = null;
  if (hasPin) {
    let best = Infinity;
    PLACES.forEach((p) => {
      const d = distKm(lat, lng, p.lat, p.lng);
      if (d < best) { best = d; nearby = { ...p, d }; }
    });
    if (nearby && nearby.d > 1) nearby = null;
  }

  const itemStyle = {
    display: "block", width: "100%", textAlign: "left", border: "none",
    borderBottom: "1px solid #f0f0f0", background: "#fff", padding: "10px 12px",
    fontSize: 13, cursor: "pointer", color: "#222",
  };
  const noteStyle = { margin: 0, padding: "10px 12px", fontSize: 13, color: "#666" };

  return (
    <div style={{ borderRadius: 12, overflow: "hidden", border: "1px solid #e3e3e3", background: "#fff" }}>
      <div style={{ position: "relative", height }}>
        <div ref={containerRef} style={{ height: "100%", width: "100%", zIndex: 0 }} />

        {/* search bar */}
        <div ref={overlayRef} style={{ position: "absolute", top: 10, left: 10, right: 10, zIndex: 1000 }}>
          <div
            style={{
              display: "flex", alignItems: "center", gap: 6, background: "#fff",
              borderRadius: 10, padding: "4px 6px 4px 12px", boxShadow: "0 2px 10px rgba(0,0,0,0.18)",
            }}
          >
            <input
              type="text"
              value={query}
              onChange={(e) => {
                pickedQuery.current = "";
                setQuery(e.target.value);
                setShowList(true);
                setMsg("");
              }}
              onFocus={() => setShowList(true)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault(); // don't submit the surrounding form
                  runSearch();
                }
              }}
              placeholder="Search hospital, barangay, or place"
              style={{ flex: 1, minWidth: 0, border: "none", outline: "none", fontSize: 14, padding: "8px 0", background: "transparent" }}
            />
            <button
              type="button"
              onClick={runSearch}
              style={{ border: "none", background: RED, color: "#fff", borderRadius: 8, padding: "7px 12px", fontSize: 13, cursor: "pointer" }}
            >
              {searching ? <span className="bl-spin sm" style={{ borderColor: "rgba(255,255,255,.4)", borderTopColor: "#fff" }} /> : "Search"}
            </button>
            <button
              type="button"
              onClick={locate}
              disabled={locating}
              aria-label="Use my current location"
              title="Use my current location"
              style={{ border: "1px solid #ddd", background: "#fff", borderRadius: 8, width: 34, height: 34, cursor: "pointer", display: "grid", placeItems: "center" }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={locating ? "#999" : RED} strokeWidth="2" strokeLinecap="round">
                <circle cx="12" cy="12" r="3.2" />
                <circle cx="12" cy="12" r="7.5" />
                <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
              </svg>
            </button>
          </div>

          {showList && q && (
            <div style={{ marginTop: 6, background: "#fff", borderRadius: 10, boxShadow: "0 2px 10px rgba(0,0,0,0.18)", maxHeight: 240, overflowY: "auto" }}>
              {matches.map((p) => (
                <button key={p.name + p.lat} type="button" onClick={() => pickPlace(p)} style={itemStyle}>
                  <strong>{p.name}</strong>
                  <div style={{ color: "#777", fontSize: 12 }}>{p.area}</div>
                </button>
              ))}
              {remote.map((item) => (
                <button key={item.place_id} type="button" onClick={() => pickRemote(item)} style={itemStyle}>
                  {item.display_name}
                  {item.kind && (
                    <div style={{ color: "#999", fontSize: 11, textTransform: "capitalize" }}>{item.kind}</div>
                  )}
                </button>
              ))}
              {searching && !remote.length && matches.length === 0 && (
                <p style={{ ...noteStyle, display: "flex", alignItems: "center", gap: 8 }}><span className="bl-spin sm" />Naghahanap...</p>
              )}
              {!searching && remoteMsg && !remote.length && <p style={noteStyle}>{remoteMsg}</p>}
              {!searching && q.length < 2 && matches.length === 0 && (
                <p style={noteStyle}>Mag-type ng hindi bababa sa 2 letra.</p>
              )}
            </div>
          )}
          {(locating || msg) && !(showList && q) && (
            <p style={{ margin: "6px 0 0", background: "#fff", borderRadius: 8, padding: "8px 12px", fontSize: 13, color: "#666", boxShadow: "0 2px 10px rgba(0,0,0,0.18)" }}>
              {locating ? "Hinahanap ang location mo..." : msg}
            </p>
          )}
        </div>

        {/* fixed center pin: the tip of the pin sits exactly on the map center */}
        <div
          style={{
            position: "absolute", left: "50%", top: "50%", zIndex: 500, pointerEvents: "none",
            transform: `translate(-50%, ${dragging ? "-118%" : "-100%"})`,
            transition: "transform 0.15s ease",
          }}
        >
          <svg width="38" height="48" viewBox="0 0 38 48" style={{ display: "block", filter: "drop-shadow(0 3px 3px rgba(0,0,0,0.3))" }}>
            <path d="M19 47C19 47 3 29.5 3 18.5a16 16 0 0132 0C35 29.5 19 47 19 47z" fill={RED} />
            <circle cx="19" cy="18.5" r="6" fill="#fff" />
          </svg>
        </div>
        <div
          style={{
            position: "absolute", left: "50%", top: "50%", zIndex: 400, pointerEvents: "none",
            width: dragging ? 12 : 8, height: dragging ? 5 : 4, borderRadius: "50%",
            background: "rgba(0,0,0,0.3)", transform: "translate(-50%, -50%)", transition: "all 0.15s ease",
          }}
        />
      </div>

      {/* location card */}
      <div style={{ padding: "12px 14px", display: "flex", alignItems: "center", gap: 12 }}>
        <svg width="22" height="22" viewBox="0 0 24 24" fill={hasPin ? RED : "#aaa"} style={{ flexShrink: 0 }}>
          <path d="M12 1.5C7.6 1.5 4 5 4 9.4 4 15 12 22.5 12 22.5S20 15 20 9.4C20 5 16.4 1.5 12 1.5zm0 10.6a2.9 2.9 0 110-5.8 2.9 2.9 0 010 5.8z" />
        </svg>
        <div style={{ flex: 1, minWidth: 0 }}>
          {hasPin ? (
            <>
              <div style={{ fontSize: 14, fontWeight: 600, color: "#222", lineHeight: 1.35 }}>
                {nearby ? `Near ${nearby.name}` : "Pinned location"}
              </div>
              <div className="db-muted" style={{ fontSize: 12, marginTop: 2 }}>
                {lat.toFixed(5)}, {lng.toFixed(5)}
              </div>
            </>
          ) : (
            <div className="db-muted" style={{ fontSize: 13 }}>
              Move the map so the pin sits on the exact spot, or search for a place.
            </div>
          )}
        </div>
        {!hasPin && (
          <button
            type="button"
            onClick={pinHere}
            style={{ border: "none", background: RED, color: "#fff", borderRadius: 8, padding: "8px 12px", fontSize: 13, cursor: "pointer", whiteSpace: "nowrap" }}
          >
            Pin this spot
          </button>
        )}
      </div>
    </div>
  );
}

export default LocationPicker;