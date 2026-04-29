const state = {
  products: [],
  filteredProducts: [],
  selectedProduct: null,
  selectedCoordinates: null,
  occurrences: [],
  customSpots: [],
  loadingProductId: null,
  activeRequestId: 0,
  userLocation: null,
  locationWatchId: null,
};

const config = window.TrondelagSankekart || {};
const API_BASE = config.apiBase || "/api";
const ASSETS_BASE = config.assetsBase || "";

const productList = document.querySelector("#product-list");
const detailPanel = document.querySelector("#detail-panel");
const searchInput = document.querySelector("#product-search");
const searchForm = document.querySelector("#product-search-form");
const searchButton = document.querySelector("#product-search-button");
const topbarProductSuggestions = document.querySelector("#topbar-product-suggestions");
const topbarActiveArt = document.querySelector("#topbar-active-art");
const mapTitle = document.querySelector("#map-title");
const statusBanner = document.querySelector("#status-banner");
const resetViewButton = document.querySelector("#reset-view");
const liveModeToggle = document.querySelector("#live-mode");
const showArtsdatabankenToggle = document.querySelector("#show-artsdatabanken");
const showTeamSpotsToggle = document.querySelector("#show-team-spots");
const showRatedOnlyToggle = document.querySelector("#show-rated-only");
const countyFilterInputs = Array.from(document.querySelectorAll(".county-filter"));
const openSpotPanelButton = document.querySelector("#open-spot-panel");
const fieldRegisterButton = document.querySelector("#field-register");
const fieldRatedOnlyButton = document.querySelector("#field-rated-only");
const fieldResetButton = document.querySelector("#field-reset");
const fieldResults = document.querySelector("#field-results");
const closeSpotPanelButton = document.querySelector("#close-spot-panel");
const mapSpotPanel = document.querySelector("#map-spot-panel");
const mapTeamSpotForm = document.querySelector("#map-team-spot-form");
const mobileFiltersToggle = document.querySelector("#mobile-filters-toggle");
const mobileFiltersPanel = document.querySelector("#mobile-filters-panel");

const DEFAULT_CENTER = [63.4305, 10.3951];
const DEFAULT_ZOOM = 9;
const DEFAULT_RADIUS_METERS = 60000;

const map = L.map("map", {
  zoomControl: true,
}).setView(DEFAULT_CENTER, DEFAULT_ZOOM);

const streetLayer = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 18,
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
});

const satelliteLayer = L.tileLayer(
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
  {
    maxZoom: 19,
    attribution: "Tiles &copy; Esri",
  },
).addTo(map);

L.control.layers(
  {
    Kart: streetLayer,
    Satelitt: satelliteLayer,
  },
  {},
  {
    position: "topright",
    collapsed: false,
  },
).addTo(map);

const markerLayer = L.layerGroup().addTo(map);
const userLocationLayer = L.layerGroup().addTo(map);
const selectedLocationLayer = L.layerGroup().addTo(map);
const trondheimFocusRing = L.circle(DEFAULT_CENTER, {
  radius: DEFAULT_RADIUS_METERS,
  color: "#27607a",
  weight: 2,
  opacity: 0.85,
  fillColor: "#27607a",
  fillOpacity: 0.08,
  dashArray: "7 9",
}).addTo(map);
trondheimFocusRing.bringToBack();

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function createTeamIcon() {
  return L.divIcon({
    className: "team-marker-wrap",
    html: `
      <div class="team-marker">
        <img src="${ASSETS_BASE}trondelag-sankeri-logo.png" alt="" class="team-marker-logo" />
      </div>
    `,
    iconSize: [36, 36],
    iconAnchor: [18, 18],
  });
}

function createSelectedLocationIcon() {
  return L.divIcon({
    className: "selected-location-wrap",
    html: `
      <div class="selected-location-pulse"></div>
      <div class="selected-location-marker"></div>
    `,
    iconSize: [34, 34],
    iconAnchor: [17, 17],
  });
}

function parseOccurrenceYear(note) {
  const match = String(note || "").match(/(\d{4})/);
  return match ? Number(match[1]) : null;
}

function distanceKmBetween(lat1, lng1, lat2, lng2) {
  const toRadians = (value) => (value * Math.PI) / 180;
  const earthRadiusKm = 6371;
  const dLat = toRadians(lat2 - lat1);
  const dLng = toRadians(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);

  return earthRadiusKm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function distanceFromReferenceKm(entry) {
  const reference = state.userLocation || { lat: DEFAULT_CENTER[0], lng: DEFAULT_CENTER[1] };
  return distanceKmBetween(reference.lat, reference.lng, Number(entry.lat), Number(entry.lng));
}

function distanceReferenceLabel() {
  return state.userLocation ? "fra deg" : "fra Trondheim";
}

function createUserLocationIcon() {
  return L.divIcon({
    className: "user-marker-wrap",
    html: `
      <div class="user-marker-pulse"></div>
      <div class="user-marker"><span>🧺</span></div>
      <div class="user-marker-label">Du</div>
    `,
    iconSize: [58, 58],
    iconAnchor: [29, 29],
  });
}

function renderUserLocationMarker(position) {
  state.userLocation = {
    lat: position.coords.latitude,
    lng: position.coords.longitude,
  };

  userLocationLayer.clearLayers();
  L.marker([state.userLocation.lat, state.userLocation.lng], {
    icon: createUserLocationIcon(),
    zIndexOffset: 1000,
  })
    .bindPopup("Du står her")
    .addTo(userLocationLayer);

  refreshCurrentMap();
}

function requestUserLocation() {
  if (!navigator.geolocation) {
    return;
  }

  state.locationWatchId = navigator.geolocation.watchPosition(
    renderUserLocationMarker,
    () => {},
    {
      enableHighAccuracy: true,
      timeout: 15000,
      maximumAge: 30000,
    },
  );
}

function getOccurrenceColorClass(occurrence) {
  const year = parseOccurrenceYear(occurrence.note);

  if (!year) {
    return "occurrence-marker-old";
  }

  if (year >= 2023) {
    return "occurrence-marker-recent";
  }

  if (year >= 2000) {
    return "occurrence-marker-mid";
  }

  return "occurrence-marker-old";
}

function createOccurrenceIcon(occurrence) {
  const rating = Number(occurrence.teamRating || 0);
  const ratedClass = rating ? "occurrence-marker-rated" : "";
  const reporter = occurrence.teamReporter ? escapeHtml(occurrence.teamReporter) : "";
  const ratingMarkup = rating
    ? `
      <span class="marker-rating-number">${rating}</span>
      <span class="marker-rating-stars">${"★".repeat(rating)}</span>
      ${reporter ? `<span class="marker-rating-reporter">${reporter}</span>` : ""}
    `
    : "";

  return L.divIcon({
    className: "occurrence-marker-wrap",
    html: `<div class="occurrence-marker ${getOccurrenceColorClass(occurrence)} ${ratedClass}">${ratingMarkup}</div>`,
    iconSize: rating ? [34, 34] : [18, 18],
    iconAnchor: rating ? [17, 17] : [9, 9],
  });
}

function createRatedTeamIcon(spot) {
  const rating = Number(spot.rating || 0);
  const reporter = spot.reporter ? escapeHtml(spot.reporter) : "";

  return L.divIcon({
    className: "team-marker-wrap",
    html: `
      <div class="team-marker team-marker-rated">
        <img src="${ASSETS_BASE}trondelag-sankeri-logo.png" alt="" class="team-marker-logo" />
        <span class="marker-rating-number">${rating}</span>
        <span class="marker-rating-stars">${"★".repeat(rating)}</span>
        ${reporter ? `<span class="marker-rating-reporter">${reporter}</span>` : ""}
      </div>
    `,
    iconSize: [40, 40],
    iconAnchor: [20, 20],
  });
}

function createVisitedLogoIcon(entry = {}) {
  const visitedLabel = entry.visitedBy ? `Besøkt av ${escapeHtml(entry.visitedBy)}` : "Besøkt nylig";

  return L.divIcon({
    className: "team-marker-wrap",
    html: `
      <div class="team-marker team-marker-visited" aria-label="${visitedLabel}">
        <img src="${ASSETS_BASE}trondelag-sankeri-logo.png" alt="" class="team-marker-logo" />
        <span class="team-marker-visited-dot" aria-hidden="true"></span>
      </div>
    `,
    iconSize: [40, 40],
    iconAnchor: [20, 20],
  });
}

function googleMapsLinks(lat, lng) {
  const encoded = `${encodeURIComponent(lat)},${encodeURIComponent(lng)}`;

  return {
    drive: `https://www.google.com/maps/dir/?api=1&destination=${encoded}&travelmode=driving`,
    walk: `https://www.google.com/maps/dir/?api=1&destination=${encoded}&travelmode=walking`,
  };
}

function navigationButtons(lat, lng) {
  const links = googleMapsLinks(lat, lng);

  return `
    <div class="navigation-actions">
      <a href="${links.drive}" target="_blank" rel="noopener">Kjør hit</a>
      <a href="${links.walk}" target="_blank" rel="noopener">Gå hit</a>
    </div>
  `;
}

function renderSpotPhotos(photos = []) {
  const validPhotos = Array.isArray(photos) ? photos.filter((photo) => photo?.dataUrl || photo?.url) : [];
  if (!validPhotos.length) {
    return "";
  }

  return `
    <div class="spot-photo-grid">
      ${validPhotos
        .map((photo) => `
          <figure class="spot-photo">
            <img src="${escapeHtml(photo.dataUrl || photo.url)}" alt="${escapeHtml(photo.name || "Bilde av funn")}" loading="lazy" />
            <figcaption>${escapeHtml(photo.name || "Feltbilde")}</figcaption>
          </figure>
        `)
        .join("")}
    </div>
  `;
}

function buildOccurrencePopup(product, occurrence) {
  const existingRating = occurrence.teamRating ? `${escapeHtml(occurrence.teamRating)} / 5` : "Ingen vurdering ennå";
  const existingMeta = occurrence.teamReporter
    ? `Sist vurdert av ${escapeHtml(occurrence.teamReporter)}`
    : "Ingen teamvurdering lagret";
  const existingComment = occurrence.teamComment
    ? `<div class="occurrence-review-comment">${escapeHtml(occurrence.teamComment)}</div>`
    : "";
  const year = parseOccurrenceYear(occurrence.note);
  const yearLabel = year ? `${year}` : "Ukjent år";
  const datasetTag = occurrence.datasetName
    ? `<span class="occurrence-popup-tag">${escapeHtml(occurrence.datasetName)}</span>`
    : "";
  const institutionTag = occurrence.institution
    ? `<span class="occurrence-popup-tag">${escapeHtml(occurrence.institution)}</span>`
    : "";
  const visitSummary = occurrence.recentVisit
    ? `<span class="occurrence-review-badge occurrence-review-badge-visited">Vært her nylig</span>
       <span>${occurrence.visitedBy ? `Markert av ${escapeHtml(occurrence.visitedBy)}` : "Markert som besøkt"} ${occurrence.visitedAt ? `· ${escapeHtml(occurrence.visitedAt.slice(0, 10))}` : ""}</span>`
    : "";
  return `
    <div class="occurrence-popup">
      <div class="occurrence-popup-head">
        <p class="occurrence-popup-kicker">Artsdatabanken-funn</p>
        <strong>${escapeHtml(product.productName)}</strong>
      </div>
      <div class="occurrence-popup-body">
        <div class="occurrence-popup-place">${escapeHtml(occurrence.place)}</div>
        <div class="occurrence-popup-note">${escapeHtml(occurrence.note)}</div>
        <div class="occurrence-popup-tags">
          <span class="occurrence-popup-tag">${yearLabel}</span>
          <span class="occurrence-popup-tag">${escapeHtml(product.scientificName)}</span>
          ${datasetTag}
          ${institutionTag}
        </div>
      </div>
      <div class="occurrence-review-summary">
        <span class="occurrence-review-badge">${existingRating}</span>
        <span>${existingMeta}</span>
        ${visitSummary}
        ${existingComment}
      </div>
      ${navigationButtons(occurrence.lat, occurrence.lng)}
      <button class="visit-button" type="button" data-target-type="occurrence" data-target-id="${escapeHtml(occurrence.sourceId)}">
        ${occurrence.recentVisit ? "Oppdater vært her" : "Vært her"}
      </button>
      <form class="occurrence-rating-form" data-source-id="${escapeHtml(occurrence.sourceId)}">
        <input type="hidden" name="sourceId" value="${escapeHtml(occurrence.sourceId)}" />
        <label>Navn</label>
        <input class="popup-input" name="reporter" type="text" placeholder="F.eks. Jim" value="${escapeHtml(occurrence.teamReporter || "")}" />
        <label>Rating</label>
        <select class="popup-input" name="rating">
          ${[5,4,3,2,1].map((value) => `<option value="${value}" ${occurrence.teamRating === value ? "selected" : ""}>${value}</option>`).join("")}
        </select>
        <label>Kommentar</label>
        <textarea class="popup-textarea" name="comment" placeholder="Kort vurdering av funnstedet">${escapeHtml(occurrence.teamComment || "")}</textarea>
        <button class="popup-submit" type="submit">${occurrence.teamRating ? "Oppdater rating" : "Gi rating"}</button>
      </form>
    </div>
  `;
}

function buildTeamSpotPopup(product, spot) {
  const visitSummary = spot.recentVisit
    ? `<span class="occurrence-review-badge occurrence-review-badge-visited">Vært her nylig</span>
       <span>${spot.visitedBy ? `Markert av ${escapeHtml(spot.visitedBy)}` : "Markert som besøkt"} ${spot.visitedAt ? `· ${escapeHtml(spot.visitedAt.slice(0, 10))}` : ""}</span>`
    : "";
  return `
    <div class="occurrence-popup">
      <div class="occurrence-popup-head">
        <p class="occurrence-popup-kicker">Eget funn</p>
        <strong>${escapeHtml(product.productName)}</strong>
      </div>
      <div class="occurrence-review-summary">
        <span class="occurrence-review-badge">${escapeHtml(spot.rating)} / 5</span>
        <span>Registrert av ${escapeHtml(spot.reporter || "Ukjent")}</span>
        ${visitSummary}
        ${spot.comment ? `<div class="occurrence-review-comment">${escapeHtml(spot.comment)}</div>` : ""}
      </div>
      ${renderSpotPhotos(spot.photos)}
      ${navigationButtons(spot.lat, spot.lng)}
      <button class="visit-button" type="button" data-target-type="team" data-target-id="${escapeHtml(spot.id)}">
        ${spot.recentVisit ? "Oppdater vært her" : "Vært her"}
      </button>
    </div>
  `;
}

function setStatus(message, type = "info") {
  statusBanner.textContent = message;
  statusBanner.classList.toggle("warning", type === "warning");
}

function setSearchState(stateName) {
  if (!searchButton) {
    return;
  }

  searchButton.classList.toggle("is-loading", stateName === "loading");
  searchButton.classList.toggle("is-complete", stateName === "complete");
  searchButton.querySelector("span").textContent =
    stateName === "loading" ? "Søker" : stateName === "complete" ? "Ferdig" : "Søk";

  if (stateName === "complete") {
    window.setTimeout(() => setSearchState("idle"), 1400);
  }
}

function isMobileViewport() {
  return window.matchMedia("(max-width: 980px)").matches;
}

function setMobileFiltersOpen(isOpen) {
  if (!mobileFiltersToggle || !mobileFiltersPanel) {
    return;
  }

  mobileFiltersToggle.setAttribute("aria-expanded", isOpen ? "true" : "false");
  mobileFiltersPanel.classList.toggle("is-open", isOpen);
}

function setSpotSaveState(form, isSaving) {
  const submitButton = form?.querySelector(".spot-submit");
  if (!submitButton) {
    return;
  }

  submitButton.disabled = isSaving;
  submitButton.classList.toggle("is-loading", isSaving);
  submitButton.textContent = isSaving ? "Lagrer funn" : "Lagre team-funn";
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 12000) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
    });
  } finally {
    window.clearTimeout(timeout);
  }
}

function clearMarkers() {
  markerLayer.clearLayers();
}

function renderSelectedLocationMarker() {
  selectedLocationLayer.clearLayers();
  if (!state.selectedCoordinates) {
    return;
  }

  L.marker([state.selectedCoordinates.lat, state.selectedCoordinates.lng], {
    icon: createSelectedLocationIcon(),
    zIndexOffset: 950,
  })
    .bindTooltip("Valgt punkt for registrering", {
      direction: "top",
      offset: [0, -16],
      opacity: 0.95,
    })
    .addTo(selectedLocationLayer);
}

function resetToDefaultView() {
  map.setView(DEFAULT_CENTER, DEFAULT_ZOOM);
  trondheimFocusRing.bringToBack();
}

function productIconFor(product) {
  return `${ASSETS_BASE}sankemerke.png`;
}

function plantIconMarkup(product, className = "product-icon") {
  const icon = productIconFor(product);
  if (icon) {
    return `<img src="${icon}" alt="" class="${className}" />`;
  }

  return `
    <span class="${className} product-icon-fallback" aria-hidden="true">
      <svg viewBox="0 0 32 32" focusable="false">
        <path d="M16 27c0-7.8 0-13.7 0-21" />
        <path d="M16 15c-5.8-.4-9.2-3.2-10.4-8.5C11.3 6 15 8.8 16 15Z" />
        <path d="M16 18c5.8-.5 9.2-3.2 10.4-8.5C20.6 9.1 17 11.8 16 18Z" />
        <path d="M16 23c-4.6-.2-7.4-2.3-8.5-6.3C12.2 16.4 15 18.5 16 23Z" />
      </svg>
    </span>
  `;
}

function normalizeSearchValue(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function productMatchesQuery(product, query) {
  const term = normalizeSearchValue(query);
  if (!term) {
    return true;
  }

  return (
    normalizeSearchValue(product.productName).includes(term) ||
    normalizeSearchValue(product.scientificName).includes(term) ||
    String(product.taxonId).includes(term)
  );
}

function bestProductMatch(query) {
  const term = normalizeSearchValue(query);
  if (!term) {
    return state.filteredProducts[0];
  }

  return (
    state.filteredProducts.find((product) => normalizeSearchValue(product.productName) === term) ||
    state.filteredProducts.find((product) => normalizeSearchValue(product.scientificName) === term) ||
    state.filteredProducts.find((product) => String(product.taxonId) === term) ||
    state.filteredProducts[0]
  );
}

function renderTopbarSuggestions() {
  if (!topbarProductSuggestions) {
    return;
  }

  const term = normalizeSearchValue(searchInput?.value);
  const suggestions = state.filteredProducts.slice(0, term ? 6 : 4);

  if (!suggestions.length) {
    topbarProductSuggestions.innerHTML = '<span class="topbar-suggestion-empty">Ingen treff ennå</span>';
    return;
  }

  topbarProductSuggestions.innerHTML = suggestions.map((product) => `
    <button
      type="button"
      class="topbar-product-suggestion ${state.selectedProduct?.id === product.id ? "active" : ""}"
      data-product-id="${escapeHtml(product.id)}"
    >
      ${plantIconMarkup(product, "topbar-suggestion-icon")}
      <span>${escapeHtml(product.productName)}</span>
      <em>${escapeHtml(product.scientificName)}</em>
    </button>
  `).join("");
}

function productOptions(selectedProductId) {
  return state.products
    .map((product) => `
      <option value="${escapeHtml(product.id)}" ${product.id === selectedProductId ? "selected" : ""}>
        ${escapeHtml(product.productName)} - ${escapeHtml(product.scientificName)}
      </option>
    `)
    .join("");
}

function seasonLabel(product) {
  const start = String(product.seasonStart || "").trim();
  const end = String(product.seasonEnd || "").trim();
  if (start && end) {
    return `uke ${start} - ${end}`;
  }
  if (start) {
    return `fra uke ${start}`;
  }
  if (end) {
    return `til uke ${end}`;
  }

  return "";
}

function syncProductSelects(selectedProductId = state.selectedProduct?.id) {
  for (const select of document.querySelectorAll(".product-select")) {
    select.innerHTML = productOptions(selectedProductId);
    select.value = selectedProductId || state.products[0]?.id || "";
  }
}

function renderProductList() {
  if (!state.filteredProducts.length) {
    productList.innerHTML = '<div class="empty-state">Ingen treff. Prøv et annet navn.</div>';
    renderTopbarSuggestions();
    return;
  }

  productList.innerHTML = "";

  for (const product of state.filteredProducts) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "product-card";
    if (state.selectedProduct?.id === product.id) {
      button.classList.add("active");
    }

    const iconMarkup = plantIconMarkup(product);
    const season = seasonLabel(product);

    button.innerHTML = `
      <div class="product-card-main">
        ${iconMarkup}
        <div>
          <h3>${product.productName}</h3>
          <p><em>${product.scientificName}</em></p>
          ${season ? `<span class="product-season">Sesong ${escapeHtml(season)}</span>` : ""}
        </div>
      </div>
    `;

    if (state.loadingProductId === product.id) {
      button.classList.add("loading");
    }

    button.addEventListener("click", () => selectProduct(product.id));
    productList.appendChild(button);
  }

  renderTopbarSuggestions();
}

function renderDetails(product, occurrences, customSpots = []) {
  detailPanel.innerHTML = `
    <p class="detail-kicker">Valgt vekst</p>
    <h2>${escapeHtml(product.productName)}</h2>
    <p><em>${escapeHtml(product.scientificName)}</em></p>
    <div class="detail-row"><strong>TaxonId</strong>${escapeHtml(product.taxonId)}</div>
    ${seasonLabel(product) ? `<div class="detail-row"><strong>Sesong</strong>${escapeHtml(seasonLabel(product))}</div>` : ""}
    <div class="detail-row"><strong>Kategori</strong>${escapeHtml(product.category)}</div>
    <div class="detail-row"><strong>Artsfunn</strong>${occurrences.length}</div>
    <div class="detail-row"><strong>Team-funn</strong>${customSpots.length}</div>
    <div class="detail-row"><strong>Kilde</strong>${escapeHtml(product.sourceLabel)}</div>
    <p>${escapeHtml(product.description)}</p>
    <div class="spot-panel">
      <p class="detail-kicker">Team-funn</p>
      <p class="spot-help">Klikk i kartet for å velge et punkt, og lagre funnet slik at alle i Trøndelag Sankeri kan se det.</p>
      <form id="team-spot-form" class="spot-form">
        <label class="spot-label" for="spot-product">Art</label>
        <select id="spot-product" name="productId" class="spot-input product-select">
          ${productOptions(product.id)}
        </select>

        <label class="spot-label" for="spot-reporter">Navn</label>
        <input id="spot-reporter" name="reporter" class="spot-input" type="text" placeholder="F.eks. Jim" />

        <label class="spot-label" for="spot-rating">Rating</label>
        <select id="spot-rating" name="rating" class="spot-input">
          <option value="5">5 - Veldig lovende</option>
          <option value="4">4 - Bra</option>
          <option value="3">3 - Ok</option>
          <option value="2">2 - Svakt</option>
          <option value="1">1 - Ikke verdt turen</option>
        </select>

        <label class="spot-label" for="spot-comment">Kommentar</label>
        <textarea id="spot-comment" name="comment" class="spot-textarea" placeholder="Skriv kort om mengde, kvalitet, adkomst eller sesong."></textarea>

        <label class="spot-label" for="spot-photos">Bilder</label>
        <input id="spot-photos" name="photos" class="spot-input" type="file" accept="image/*" multiple />
        <p class="spot-help">Legg gjerne ved opptil 3 bilder av voksested, mengde, kvalitet, adkomst eller selve planten/soppen.</p>

        <div class="spot-coordinates" id="spot-coordinates">Ingen kartposisjon valgt ennå.</div>
        <button class="spot-submit" type="submit">Lagre team-funn</button>
      </form>
      <div id="team-spot-list" class="team-spot-list"></div>
    </div>
  `;

  renderTeamSpotList(customSpots);
  syncSpotCoordinatesText();
  syncProductSelects(product.id);

  const teamSpotForm = document.querySelector("#team-spot-form");
  teamSpotForm?.addEventListener("submit", saveTeamSpot);
}

function renderTeamSpotList(customSpots) {
  const list = document.querySelector("#team-spot-list");
  if (!list) {
    return;
  }

  if (!customSpots.length) {
    list.innerHTML = '<div class="empty-state">Ingen team-funn registrert ennå.</div>';
    return;
  }

  list.innerHTML = customSpots
    .map((spot) => {
      const reporter = spot.reporter ? escapeHtml(spot.reporter) : "Ukjent";
      const comment = spot.comment ? escapeHtml(spot.comment) : "Ingen kommentar";
      return `
        <article class="team-spot-card">
          <div class="team-spot-head">
            <strong>${"★".repeat(spot.rating)}</strong>
            <span>${reporter}</span>
          </div>
          <p>${comment}</p>
          ${renderSpotPhotos(spot.photos)}
          <div class="team-spot-meta">${escapeHtml(spot.createdAt)}</div>
        </article>
      `;
    })
    .join("");
}

function syncSpotCoordinatesText() {
  for (const id of ["spot-coordinates", "map-spot-coordinates"]) {
    const coordinates = document.querySelector(`#${id}`);
    if (!coordinates) {
      continue;
    }

    if (!state.selectedCoordinates) {
      coordinates.textContent = "Ingen kartposisjon valgt ennå.";
      continue;
    }

    coordinates.textContent = `Valgt punkt: ${state.selectedCoordinates.lat.toFixed(6)}, ${state.selectedCoordinates.lng.toFixed(6)}`;
  }
}

function readImageFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const image = new Image();
      image.onload = () => {
        const maxSide = 1280;
        const scale = Math.min(1, maxSide / Math.max(image.width, image.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(image.width * scale));
        canvas.height = Math.max(1, Math.round(image.height * scale));
        const context = canvas.getContext("2d");
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        const dataUrl = canvas.toDataURL("image/jpeg", 0.76);
        resolve({
          name: file.name,
          type: "image/jpeg",
          size: Math.round((dataUrl.length * 3) / 4),
          dataUrl,
        });
      };
      image.onerror = () => resolve({
        name: file.name,
        type: file.type,
        size: file.size,
        dataUrl: reader.result,
      });
      image.src = reader.result;
    };
    reader.onerror = () => reject(new Error("Kunne ikke lese bildet"));
    reader.readAsDataURL(file);
  });
}

async function readSpotPhotos(form) {
  const files = Array.from(form.querySelector('input[name="photos"]')?.files || [])
    .filter((file) => file.type.startsWith("image/"))
    .slice(0, 3);

  if (!files.length) {
    return [];
  }

  return Promise.all(files.map(readImageFile));
}

function setSpotPanelOpen(isOpen) {
  mapSpotPanel?.classList.toggle("hidden", !isOpen);
  openSpotPanelButton?.classList.toggle("hidden", isOpen);
}

function hasRating(entry) {
  return Number(entry.teamRating || entry.rating || 0) > 0;
}

function selectedLocationFilters() {
  const counties = countyFilterInputs
    .filter((input) => input.checked)
    .map((input) => input.value)
    .filter(Boolean);
  const countyIds = countyFilterInputs
    .filter((input) => input.checked)
    .map((input) => input.dataset.countyId)
    .filter(Boolean);
  return { counties, countyIds };
}

function locationFilterQueryString() {
  const filters = selectedLocationFilters();
  const params = new URLSearchParams();

  if (filters.counties.length) {
    params.set("counties", filters.counties.join(","));
  }

  if (filters.countyIds.length) {
    params.set("countyIds", filters.countyIds.join(","));
  }

  return params.toString();
}

function addOccurrencesToMap(product, occurrences, customSpots = []) {
  clearMarkers();

  const ratedOnly = showRatedOnlyToggle?.checked === true;
  const visibleOccurrences = showArtsdatabankenToggle?.checked === false
    ? []
    : occurrences.filter((occurrence) => !ratedOnly || hasRating(occurrence));
  const visibleCustomSpots = showTeamSpotsToggle?.checked === false
    ? []
    : customSpots.filter((spot) => !ratedOnly || hasRating(spot));

  if (!visibleOccurrences.length && !visibleCustomSpots.length) {
    renderFieldResults(product, [], []);

    if (ratedOnly && (occurrences.length || customSpots.length)) {
      setStatus(
        `${product.productName} har ${occurrences.length} artsfunn og ${customSpots.length} team-funn, men de skjules fordi "Kun vurderte" er på.`,
        "warning",
      );
      return;
    }

    if (showArtsdatabankenToggle?.checked === false && occurrences.length) {
      setStatus(
        `${product.productName} har ${occurrences.length} Artsdatabanken-funn, men "Funn fra Artsdatabanken" er slått av.`,
        "warning",
      );
      return;
    }

    if (showTeamSpotsToggle?.checked === false && customSpots.length) {
      setStatus(
        `${product.productName} har ${customSpots.length} team-funn, men "Egne/team-funn" er slått av.`,
        "warning",
      );
      return;
    }

    setStatus(`Ingen funn i valgte område/datavalg for ${product.productName}. Prøv å fjerne kommuneavhukingene for å se hele Trøndelag.`, "warning");
    return;
  }

  for (const occurrence of visibleOccurrences) {
    const marker = L.marker([occurrence.lat, occurrence.lng], {
      icon: occurrence.recentVisit ? createVisitedLogoIcon(occurrence) : createOccurrenceIcon(occurrence),
    }).bindPopup(buildOccurrencePopup(product, occurrence));

    marker.addTo(markerLayer);
  }

  for (const spot of visibleCustomSpots) {
    const marker = L.marker([spot.lat, spot.lng], {
      icon: spot.recentVisit ? createVisitedLogoIcon(spot) : createRatedTeamIcon(spot),
    }).bindPopup(buildTeamSpotPopup(product, spot));

    marker.addTo(markerLayer);
  }

  trondheimFocusRing.bringToBack();
  renderFieldResults(product, visibleOccurrences, visibleCustomSpots);
  setStatus(`Viser ${visibleOccurrences.length} artsfunn og ${visibleCustomSpots.length} team-funn for ${product.productName}.`);
}

function refreshCurrentMap() {
  if (!state.selectedProduct) {
    return;
  }

  addOccurrencesToMap(state.selectedProduct, state.occurrences, state.customSpots);
}

function fieldResultScore(entry) {
  const rating = Number(entry.teamRating || entry.rating || 0);
  const year = parseOccurrenceYear(entry.note || entry.createdAt);
  const isTeamSpot = entry.type === "team";
  const distance = distanceFromReferenceKm(entry);

  return (isTeamSpot ? 800 : 0) + rating * 700 + (year || 0) * 2 - distance * 25;
}

function renderFieldResults(product, occurrences, customSpots) {
  if (!fieldResults || !product) {
    return;
  }

  const items = [
    ...customSpots.map((spot) => ({ ...spot, type: "team" })),
    ...occurrences.map((occurrence) => ({ ...occurrence, type: "artsdatabanken" })),
  ]
    .filter((entry) => Number.isFinite(Number(entry.lat)) && Number.isFinite(Number(entry.lng)))
    .sort((a, b) => fieldResultScore(b) - fieldResultScore(a))
    .slice(0, 5);

  if (!items.length) {
    fieldResults.innerHTML = "";
    return;
  }

  fieldResults.innerHTML = `
    <div class="field-results-head">
      <div>
        <p class="detail-kicker">Feltliste</p>
        <h3>Beste steder for ${escapeHtml(product.productName)}</h3>
      </div>
      <span>${items.length} forslag</span>
    </div>
    <div class="field-result-list">
      ${items.map((entry, index) => {
        const rating = Number(entry.teamRating || entry.rating || 0);
        const distance = distanceFromReferenceKm(entry);
        const title = entry.type === "team" ? "Eget funn" : escapeHtml(entry.place || "Artsfunn");
        const meta = [
          entry.type === "team" ? "Internt" : "Artsdatabanken",
          rating ? `${rating}/5` : "Ikke vurdert",
          `${distance.toFixed(1)} km ${distanceReferenceLabel()}`,
        ].filter(Boolean).join(" · ");
        const links = googleMapsLinks(entry.lat, entry.lng);

        return `
          <article class="field-result-card">
            <button type="button" class="field-result-focus" data-result-index="${index}">
              <strong>${title}</strong>
              <span>${escapeHtml(meta)}</span>
            </button>
            <div class="field-result-actions">
              <a href="${links.drive}" target="_blank" rel="noopener">Bil</a>
              <a href="${links.walk}" target="_blank" rel="noopener">Gå</a>
            </div>
          </article>
        `;
      }).join("")}
    </div>
  `;

  fieldResults.querySelectorAll(".field-result-focus").forEach((button) => {
    button.addEventListener("click", () => {
      const entry = items[Number(button.dataset.resultIndex)];
      if (!entry) {
        return;
      }

      map.setView([entry.lat, entry.lng], 14);
      setStatus(`Viser valgt funn for ${product.productName}.`);
    });
  });
}

async function selectProduct(productId) {
  const product = state.products.find((entry) => entry.id === productId);
  if (!product) {
    return;
  }

  const requestId = state.activeRequestId + 1;
  state.activeRequestId = requestId;
  state.selectedProduct = product;
  state.loadingProductId = product.id;
  renderProductList();
  syncProductSelects(product.id);
  if (isMobileViewport()) {
    setMobileFiltersOpen(false);
  }
  mapTitle.textContent = product.productName;
  if (topbarActiveArt) {
    topbarActiveArt.innerHTML = `${plantIconMarkup(product, "active-art-icon")}<span>${escapeHtml(product.productName)}</span>`;
  }
  setStatus(`Laster funn for ${product.productName}...`);

  try {
    const locationQuery = locationFilterQueryString();
    const response = await fetchWithTimeout(
      `${API_BASE}/occurrences?productId=${encodeURIComponent(productId)}&live=${liveModeToggle.checked ? "1" : "0"}${locationQuery ? `&${locationQuery}` : ""}`,
      {},
      75000,
    );
    if (!response.ok) {
      throw new Error("Kunne ikke hente funn");
    }

    const payload = await response.json();
    if (requestId !== state.activeRequestId) {
      return;
    }
    product.sourceLabel = payload.sourceLabel || product.sourceLabel;
    state.selectedCoordinates = null;
    renderSelectedLocationMarker();
    state.occurrences = payload.occurrences || [];
    state.customSpots = payload.customSpots || [];
    renderDetails(product, state.occurrences, state.customSpots, null);
    addOccurrencesToMap(product, state.occurrences, state.customSpots);
    setSearchState("complete");

    if (payload.liveMode && payload.sourceLabel === "Prøvedata") {
      setStatus(
        `Live-modus er slått på, men vi falt tilbake til prøvedata. Artskart-parametrene kan trenge en liten justering.`,
        "warning",
      );
    }
  } catch (error) {
    if (requestId !== state.activeRequestId) {
      return;
    }
    renderDetails(product, []);
    clearMarkers();
    renderSelectedLocationMarker();
    setStatus(
      `Kunne ikke hente funn akkurat nå. Prototypen kan fortsatt kobles til Artskart via backend.`,
      "warning",
    );
  } finally {
    state.loadingProductId = null;
    renderProductList();
  }
}

async function saveTeamSpot(event) {
  event.preventDefault();
  const form = event.currentTarget;

  if (!state.selectedCoordinates) {
    setStatus("Klikk i kartet først for å velge hvor funnet skal lagres.", "warning");
    return;
  }

  const formData = new FormData(form);
  const selectedProductId = formData.get("productId") || state.selectedProduct?.id;
  const selectedProduct = state.products.find((product) => product.id === selectedProductId);

  if (!selectedProduct) {
    setStatus("Velg hvilken art funnet gjelder før du lagrer.", "warning");
    return;
  }

  setSpotSaveState(form, true);
  setStatus(`Lagrer team-funn for ${selectedProduct.productName}...`);

  const payload = {
    productId: selectedProduct.id,
    reporter: formData.get("reporter"),
    rating: Number(formData.get("rating")),
    comment: formData.get("comment"),
    lat: state.selectedCoordinates.lat,
    lng: state.selectedCoordinates.lng,
    photos: await readSpotPhotos(form),
  };

  try {
    const response = await fetch(`${API_BASE}/spots`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-WP-Nonce": config.nonce || "",
      },
      body: JSON.stringify(payload),
    });

    const data = await response.json();
    if (!response.ok) {
      setStatus(data.error || "Kunne ikke lagre team-funnet.", "warning");
      return;
    }

    form.reset();
    mapTeamSpotForm?.reset();
    state.selectedCoordinates = null;
    syncSpotCoordinatesText();
    renderSelectedLocationMarker();
    setSpotPanelOpen(false);
    await selectProduct(selectedProduct.id);
    setStatus(`Team-funnet er lagret på ${selectedProduct.productName} og er synlig for alle som bruker denne appen.`);
  } catch (error) {
    setStatus("Kunne ikke lagre team-funnet akkurat nå. Prøv igjen.", "warning");
  } finally {
    setSpotSaveState(form, false);
  }
}

async function saveOccurrenceRating(event) {
  const form = event.target.closest(".occurrence-rating-form");
  if (!form) {
    return;
  }

  event.preventDefault();
  const formData = new FormData(form);
  const payload = {
    sourceId: formData.get("sourceId"),
    reporter: formData.get("reporter"),
    rating: Number(formData.get("rating")),
    comment: formData.get("comment"),
  };

  const response = await fetch(`${API_BASE}/occurrence-ratings`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-WP-Nonce": config.nonce || "",
    },
    body: JSON.stringify(payload),
  });

  const data = await response.json();
  if (!response.ok) {
    setStatus(data.error || "Kunne ikke lagre vurderingen.", "warning");
    return;
  }

  setStatus("Vurderingen er lagret for dette Artsdatabanken-funnet.");
  if (state.selectedProduct) {
    await selectProduct(state.selectedProduct.id);
  }
}

async function markSpotVisited(button) {
  const payload = {
    targetType: button.dataset.targetType,
    targetId: button.dataset.targetId,
  };

  button.disabled = true;
  button.textContent = "Lagrer...";

  try {
    const response = await fetch(`${API_BASE}/spot-visits`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-WP-Nonce": config.nonce || "",
      },
      body: JSON.stringify(payload),
    });
    const data = await response.json();
    if (!response.ok) {
      setStatus(data.error || "Kunne ikke markere besøket.", "warning");
      return;
    }

    setStatus("Spottet er markert som besøkt de neste 10 dagene.");
    if (state.selectedProduct) {
      await selectProduct(state.selectedProduct.id);
    }
  } catch (error) {
    setStatus("Kunne ikke lagre besøksmarkeringen akkurat nå.", "warning");
  } finally {
    button.disabled = false;
    button.textContent = "Vært her";
  }
}

function filterProducts(query) {
  state.filteredProducts = state.products.filter((product) => productMatchesQuery(product, query));

  renderProductList();
}

async function boot() {
  requestUserLocation();
  const initialProducts = Array.isArray(config.initialProducts) ? config.initialProducts : [];

  if (initialProducts.length) {
    state.products = initialProducts;
    state.filteredProducts = initialProducts;
    renderProductList();
    syncProductSelects(initialProducts[0]?.id);
    setStatus("Velg en vekst i listen for å vise registrerte funn.");
    return;
  }

  try {
    const response = await fetchWithTimeout(`${API_BASE}/products`, {}, 5000);
    if (!response.ok) {
      throw new Error("Kunne ikke hente produkter");
    }

    const payload = await response.json();
    state.products = payload.products;
    state.filteredProducts = payload.products;
    renderProductList();
    syncProductSelects(payload.products[0]?.id);
    setStatus("Velg en vekst i listen for å vise registrerte funn.");
  } catch (error) {
    if (state.products.length) {
      return;
    }
    setStatus("Kunne ikke laste produkter. Sjekk at serveren kjører.", "warning");
    productList.innerHTML =
      '<div class="empty-state">Produktlisten kunne ikke lastes. Start serveren på nytt og prøv igjen.</div>';
  }
}

searchInput.addEventListener("input", (event) => {
  filterProducts(event.target.value);
});

searchForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  filterProducts(searchInput.value);

  if (!state.filteredProducts.length) {
    setStatus("Ingen art traff søket. Prøv norsk navn, latinsk navn eller TaxonId.", "warning");
    setSearchState("idle");
    return;
  }

  setSearchState("loading");
  await selectProduct(bestProductMatch(searchInput.value).id);
});

topbarProductSuggestions?.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-product-id]");
  if (!button) {
    return;
  }

  setSearchState("loading");
  await selectProduct(button.dataset.productId);
});

resetViewButton.addEventListener("click", () => {
  resetToDefaultView();
});

map.on("click", (event) => {
  state.selectedCoordinates = event.latlng;
  syncSpotCoordinatesText();
  renderSelectedLocationMarker();
  setStatus(`Valgt kartpunkt for nytt team-funn: ${event.latlng.lat.toFixed(5)}, ${event.latlng.lng.toFixed(5)}`);
});

openSpotPanelButton?.addEventListener("click", () => {
  if (!state.products.length) {
    setStatus("Produktlisten er ikke lastet ennå. Prøv igjen om et øyeblikk.", "warning");
    return;
  }

  syncProductSelects(state.selectedProduct?.id || state.products[0]?.id);
  setSpotPanelOpen(true);
  syncSpotCoordinatesText();
  setStatus("Velg art, klikk i kartet og lagre funnet.");
});

closeSpotPanelButton?.addEventListener("click", () => {
  setSpotPanelOpen(false);
});

document.addEventListener("click", (event) => {
  if (!mapSpotPanel || mapSpotPanel.classList.contains("hidden")) {
    const visitButton = event.target.closest(".visit-button");
    if (!visitButton) {
      return;
    }
    markSpotVisited(visitButton);
    return;
  }

  const visitButton = event.target.closest(".visit-button");
  if (visitButton) {
    markSpotVisited(visitButton);
    return;
  }

  const clickedInsidePanel = mapSpotPanel.contains(event.target);
  const clickedOpenButton = openSpotPanelButton?.contains(event.target) || fieldRegisterButton?.contains(event.target);
  if (!clickedInsidePanel && !clickedOpenButton) {
    setSpotPanelOpen(false);
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    setSpotPanelOpen(false);
  }
});

fieldRegisterButton?.addEventListener("click", () => {
  openSpotPanelButton?.click();
});

fieldRatedOnlyButton?.addEventListener("click", () => {
  if (!showRatedOnlyToggle) {
    return;
  }

  showRatedOnlyToggle.checked = !showRatedOnlyToggle.checked;
  fieldRatedOnlyButton.classList.toggle("active", showRatedOnlyToggle.checked);
  refreshCurrentMap();
});

fieldResetButton?.addEventListener("click", () => {
  resetToDefaultView();
});

mobileFiltersToggle?.addEventListener("click", () => {
  const isOpen = mobileFiltersToggle.getAttribute("aria-expanded") === "true";
  setMobileFiltersOpen(!isOpen);
});

window.addEventListener("resize", () => {
  if (!isMobileViewport()) {
    setMobileFiltersOpen(true);
  }
});

mapTeamSpotForm?.addEventListener("submit", saveTeamSpot);
document.addEventListener("submit", saveOccurrenceRating);

liveModeToggle.addEventListener("change", async () => {
  if (state.selectedProduct) {
    await selectProduct(state.selectedProduct.id);
  }
});

for (const input of countyFilterInputs) {
  input.addEventListener("change", async () => {
    if (state.selectedProduct) {
      await selectProduct(state.selectedProduct.id);
    }
  });
}

for (const toggle of [showArtsdatabankenToggle, showTeamSpotsToggle, showRatedOnlyToggle]) {
  toggle?.addEventListener("change", async () => {
    refreshCurrentMap();
  });
}

boot();
