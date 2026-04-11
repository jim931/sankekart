const state = {
  products: [],
  filteredProducts: [],
  selectedProduct: null,
  selectedCoordinates: null,
  occurrences: [],
  customSpots: [],
};

const productList = document.querySelector("#product-list");
const detailPanel = document.querySelector("#detail-panel");
const searchInput = document.querySelector("#product-search");
const mapTitle = document.querySelector("#map-title");
const statusBanner = document.querySelector("#status-banner");
const resetViewButton = document.querySelector("#reset-view");
const liveModeToggle = document.querySelector("#live-mode");
const showArtsdatabankenToggle = document.querySelector("#show-artsdatabanken");
const showTeamSpotsToggle = document.querySelector("#show-team-spots");
const showRatedOnlyToggle = document.querySelector("#show-rated-only");
const openSpotPanelButton = document.querySelector("#open-spot-panel");
const closeSpotPanelButton = document.querySelector("#close-spot-panel");
const mapSpotPanel = document.querySelector("#map-spot-panel");
const mapTeamSpotForm = document.querySelector("#map-team-spot-form");

const DEFAULT_CENTER = [63.4305, 10.3951];
const DEFAULT_ZOOM = 9;
const DEFAULT_RADIUS_METERS = 60000;

const map = L.map("map", {
  zoomControl: true,
}).setView(DEFAULT_CENTER, DEFAULT_ZOOM);

L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 18,
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
}).addTo(map);

const markerLayer = L.layerGroup().addTo(map);
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
    html: '<div class="team-marker"></div>',
    iconSize: [20, 20],
    iconAnchor: [10, 10],
  });
}

function parseOccurrenceYear(note) {
  const match = String(note || "").match(/(\d{4})/);
  return match ? Number(match[1]) : null;
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
        <span class="marker-rating-number">${rating}</span>
        <span class="marker-rating-stars">${"★".repeat(rating)}</span>
        ${reporter ? `<span class="marker-rating-reporter">${reporter}</span>` : ""}
      </div>
    `,
    iconSize: [34, 34],
    iconAnchor: [17, 17],
  });
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
        </div>
      </div>
      <div class="occurrence-review-summary">
        <span class="occurrence-review-badge">${existingRating}</span>
        <span>${existingMeta}</span>
        ${existingComment}
      </div>
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

function setStatus(message, type = "info") {
  statusBanner.textContent = message;
  statusBanner.classList.toggle("warning", type === "warning");
}

function clearMarkers() {
  markerLayer.clearLayers();
}

function resetToDefaultView() {
  map.setView(DEFAULT_CENTER, DEFAULT_ZOOM);
  trondheimFocusRing.bringToBack();
}

function productIconFor(product) {
  return product.productName.toLowerCase().includes("ryllik") ? "/ryllik-icon.svg" : null;
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

function syncProductSelects(selectedProductId = state.selectedProduct?.id) {
  for (const select of document.querySelectorAll(".product-select")) {
    select.innerHTML = productOptions(selectedProductId);
    select.value = selectedProductId || state.products[0]?.id || "";
  }
}

function renderProductList() {
  if (!state.filteredProducts.length) {
    productList.innerHTML = '<div class="empty-state">Ingen treff. Prøv et annet navn.</div>';
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

    const icon = productIconFor(product);
    const iconMarkup = icon
      ? `<img src="${icon}" alt="" class="product-icon" />`
      : '<span class="product-icon product-icon-fallback"></span>';

    button.innerHTML = `
      <div class="product-card-main">
        ${iconMarkup}
        <div>
          <h3>${product.productName}</h3>
          <p><em>${product.scientificName}</em></p>
          <span class="product-meta">${product.category} • TaxonId ${product.taxonId}</span>
        </div>
      </div>
    `;

    button.addEventListener("click", () => selectProduct(product.id));
    productList.appendChild(button);
  }
}

function renderDetails(product, occurrences, customSpots = []) {
  detailPanel.innerHTML = `
    <p class="detail-kicker">Valgt vekst</p>
    <h2>${escapeHtml(product.productName)}</h2>
    <p><em>${escapeHtml(product.scientificName)}</em></p>
    <div class="detail-row"><strong>TaxonId</strong>${escapeHtml(product.taxonId)}</div>
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

function setSpotPanelOpen(isOpen) {
  mapSpotPanel?.classList.toggle("hidden", !isOpen);
  openSpotPanelButton?.classList.toggle("hidden", isOpen);
}

function hasRating(entry) {
  return Number(entry.teamRating || entry.rating || 0) > 0;
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
    setStatus(`Ingen valgte datakilder viser funn for ${product.productName}.`, "warning");
    return;
  }

  for (const occurrence of visibleOccurrences) {
    const marker = L.marker([occurrence.lat, occurrence.lng], {
      icon: createOccurrenceIcon(occurrence),
    }).bindPopup(buildOccurrencePopup(product, occurrence));

    marker.addTo(markerLayer);
  }

  for (const spot of visibleCustomSpots) {
    const marker = L.marker([spot.lat, spot.lng], { icon: createRatedTeamIcon(spot) }).bindPopup(`
      <strong>${escapeHtml(product.productName)} - team-funn</strong><br />
      Rating: ${escapeHtml(spot.rating)} / 5<br />
      Registrert av: ${escapeHtml(spot.reporter || "Ukjent")}<br />
      ${escapeHtml(spot.comment || "Ingen kommentar")}
    `);

    marker.addTo(markerLayer);
  }

  trondheimFocusRing.bringToBack();
  setStatus(`Viser ${visibleOccurrences.length} artsfunn og ${visibleCustomSpots.length} team-funn for ${product.productName}.`);
}

function refreshCurrentMap() {
  if (!state.selectedProduct) {
    return;
  }

  addOccurrencesToMap(state.selectedProduct, state.occurrences, state.customSpots);
}

async function selectProduct(productId) {
  const product = state.products.find((entry) => entry.id === productId);
  if (!product) {
    return;
  }

  state.selectedProduct = product;
  renderProductList();
  syncProductSelects(product.id);
  mapTitle.textContent = product.productName;
  setStatus(`Laster funn for ${product.productName}...`);

  try {
    const response = await fetch(
      `/api/occurrences?productId=${encodeURIComponent(productId)}&live=${liveModeToggle.checked ? "1" : "0"}`,
    );
    if (!response.ok) {
      throw new Error("Kunne ikke hente funn");
    }

    const payload = await response.json();
    product.sourceLabel = payload.sourceLabel || product.sourceLabel;
    state.selectedCoordinates = null;
    state.occurrences = payload.occurrences || [];
    state.customSpots = payload.customSpots || [];
    renderDetails(product, state.occurrences, state.customSpots);
    addOccurrencesToMap(product, state.occurrences, state.customSpots);

    if (payload.liveMode && payload.sourceLabel === "Prøvedata") {
      setStatus(
        `Live-modus er slått på, men vi falt tilbake til prøvedata. Artskart-parametrene kan trenge en liten justering.`,
        "warning",
      );
    }
  } catch (error) {
    renderDetails(product, []);
    clearMarkers();
    setStatus(
      `Kunne ikke hente funn akkurat nå. Prototypen kan fortsatt kobles til Artskart via backend.`,
      "warning",
    );
  }
}

async function saveTeamSpot(event) {
  event.preventDefault();

  if (!state.selectedCoordinates) {
    setStatus("Klikk i kartet først for å velge hvor funnet skal lagres.", "warning");
    return;
  }

  const form = event.currentTarget;
  const formData = new FormData(form);
  const selectedProductId = formData.get("productId") || state.selectedProduct?.id;
  const selectedProduct = state.products.find((product) => product.id === selectedProductId);

  if (!selectedProduct) {
    setStatus("Velg hvilken art funnet gjelder før du lagrer.", "warning");
    return;
  }

  const payload = {
    productId: selectedProduct.id,
    reporter: formData.get("reporter"),
    rating: Number(formData.get("rating")),
    comment: formData.get("comment"),
    lat: state.selectedCoordinates.lat,
    lng: state.selectedCoordinates.lng,
  };

  const response = await fetch("/api/spots", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
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
  await selectProduct(selectedProduct.id);
  setSpotPanelOpen(false);
  setStatus(`Team-funnet er lagret på ${selectedProduct.productName} og er synlig for alle som bruker denne appen.`);
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

  const response = await fetch("/api/occurrence-ratings", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
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

function filterProducts(query) {
  const term = query.trim().toLowerCase();

  state.filteredProducts = state.products.filter((product) => {
    return (
      product.productName.toLowerCase().includes(term) ||
      product.scientificName.toLowerCase().includes(term) ||
      String(product.taxonId).includes(term)
    );
  });

  renderProductList();
}

async function boot() {
  try {
    const response = await fetch("/api/products");
    if (!response.ok) {
      throw new Error("Kunne ikke hente produkter");
    }

    const payload = await response.json();
    state.products = payload.products;
    state.filteredProducts = payload.products;
    renderProductList();
    syncProductSelects(payload.products[0]?.id);
    setStatus("Velg en vekst i listen for å vise registrerte funn.");

    if (payload.products.length) {
      await selectProduct(payload.products[0].id);
    }
  } catch (error) {
    setStatus("Kunne ikke laste produkter. Sjekk at serveren kjører.", "warning");
    productList.innerHTML =
      '<div class="empty-state">Produktlisten kunne ikke lastes. Start serveren på nytt og prøv igjen.</div>';
  }
}

searchInput.addEventListener("input", (event) => {
  filterProducts(event.target.value);
});

resetViewButton.addEventListener("click", () => {
  resetToDefaultView();
});

map.on("click", (event) => {
  state.selectedCoordinates = event.latlng;
  syncSpotCoordinatesText();
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

mapTeamSpotForm?.addEventListener("submit", saveTeamSpot);
document.addEventListener("submit", saveOccurrenceRating);

liveModeToggle.addEventListener("change", async () => {
  if (state.selectedProduct) {
    await selectProduct(state.selectedProduct.id);
  }
});

for (const toggle of [showArtsdatabankenToggle, showTeamSpotsToggle, showRatedOnlyToggle]) {
  toggle?.addEventListener("change", async () => {
    refreshCurrentMap();
  });
}

boot();
