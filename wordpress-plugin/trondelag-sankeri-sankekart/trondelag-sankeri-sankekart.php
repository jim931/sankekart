<?php
/**
 * Plugin Name: Trøndelag Sankeri AS - Sankekart
 * Description: Søkbart sankekart med råvarer fra monday.com, funn fra Artsdatabanken og interne team-vurderinger.
 * Version: 0.2.2
 * Author: Trøndelag Sankeri AS
 */

if (!defined('ABSPATH')) {
    exit;
}

define('TSK_PLUGIN_FILE', __FILE__);
define('TSK_PLUGIN_DIR', plugin_dir_path(__FILE__));
define('TSK_PLUGIN_URL', plugin_dir_url(__FILE__));
define('TSK_OPTION_KEY', 'tsk_sankekart_settings');
define('TSK_TEAM_SPOTS_KEY', 'tsk_sankekart_team_spots');
define('TSK_OCCURRENCE_RATINGS_KEY', 'tsk_sankekart_occurrence_ratings');
define('TSK_SPOT_VISITS_KEY', 'tsk_sankekart_spot_visits');
define('TSK_SUPPLEMENTAL_PRODUCTS_FILE', TSK_PLUGIN_DIR . 'assets/pensum-products-supplement.json');

function tsk_default_settings() {
    return [
        'monday_api_token' => '',
        'monday_board_id' => '',
        'monday_api_version' => '2025-04',
        'product_name_column_id' => 'dropdown_mm1jyaet',
        'scientific_name_column_id' => 'latinsk_navn',
        'taxon_id_column_id' => 'text_mm2a18m3',
        'season_start_column_id' => 'numbers86',
        'season_end_column_id' => 'numbers67',
        'category_column_id' => '',
        'default_counties' => 'Trøndelag',
        'default_county_ids' => '16,17',
        'artsdatabanken_live' => '1',
    ];
}

function tsk_settings() {
    return wp_parse_args(get_option(TSK_OPTION_KEY, []), tsk_default_settings());
}

function tsk_activate() {
    add_option(TSK_OPTION_KEY, tsk_default_settings());
    add_option(TSK_TEAM_SPOTS_KEY, []);
    add_option(TSK_OCCURRENCE_RATINGS_KEY, []);
    add_option(TSK_SPOT_VISITS_KEY, []);
}
register_activation_hook(__FILE__, 'tsk_activate');

function tsk_register_settings() {
    register_setting('tsk_sankekart', TSK_OPTION_KEY, [
        'type' => 'array',
        'sanitize_callback' => 'tsk_sanitize_settings',
        'default' => tsk_default_settings(),
    ]);
}
add_action('admin_init', 'tsk_register_settings');

function tsk_sanitize_settings($input) {
    $defaults = tsk_default_settings();
    $clean = [];

    foreach ($defaults as $key => $default) {
        $value = isset($input[$key]) ? $input[$key] : $default;
        $clean[$key] = is_string($value) ? sanitize_text_field($value) : $default;
    }

    return $clean;
}

function tsk_admin_menu() {
    add_options_page(
        'Sankekart',
        'Sankekart',
        'manage_options',
        'tsk-sankekart',
        'tsk_render_settings_page'
    );
}
add_action('admin_menu', 'tsk_admin_menu');

function tsk_render_settings_page() {
    if (!current_user_can('manage_options')) {
        return;
    }

    $settings = tsk_settings();
    ?>
    <div class="wrap">
        <h1>Trøndelag Sankeri AS - Sankekart</h1>
        <p>Legg inn monday.com-oppsett her. Vis kartet på en side med shortcoden <code>[sankekart]</code>.</p>
        <form method="post" action="options.php">
            <?php settings_fields('tsk_sankekart'); ?>
            <table class="form-table" role="presentation">
                <?php foreach (tsk_default_settings() as $key => $default) : ?>
                    <tr>
                        <th scope="row">
                            <label for="tsk_<?php echo esc_attr($key); ?>"><?php echo esc_html($key); ?></label>
                        </th>
                        <td>
                            <input
                                id="tsk_<?php echo esc_attr($key); ?>"
                                name="<?php echo esc_attr(TSK_OPTION_KEY . '[' . $key . ']'); ?>"
                                type="<?php echo $key === 'monday_api_token' ? 'password' : 'text'; ?>"
                                class="regular-text"
                                value="<?php echo esc_attr($settings[$key]); ?>"
                            />
                        </td>
                    </tr>
                <?php endforeach; ?>
            </table>
            <?php submit_button('Lagre innstillinger'); ?>
        </form>
    </div>
    <?php
}

function tsk_shortcode() {
    wp_enqueue_style('tsk-leaflet', 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css', [], '1.9.4');
    wp_enqueue_style('tsk-sankekart', TSK_PLUGIN_URL . 'assets/styles.css', ['tsk-leaflet'], filemtime(TSK_PLUGIN_DIR . 'assets/styles.css'));
    wp_enqueue_script('tsk-leaflet', 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js', [], '1.9.4', true);
    wp_enqueue_script('tsk-sankekart', TSK_PLUGIN_URL . 'assets/app.js', ['tsk-leaflet'], filemtime(TSK_PLUGIN_DIR . 'assets/app.js'), true);
    wp_localize_script('tsk-sankekart', 'TrondelagSankekart', [
        'apiBase' => esc_url_raw(rest_url('trondelag-sankeri/v1')),
        'assetsBase' => esc_url_raw(TSK_PLUGIN_URL . 'assets/'),
        'nonce' => wp_create_nonce('wp_rest'),
        'initialProducts' => tsk_fetch_products_with_supplement(),
    ]);

    ob_start();
    ?>
    <div class="tsk-sankekart-root">
      <header class="app-topbar">
        <div class="topbar-brand">
          <div class="topbar-brand-card">
            <img src="<?php echo esc_url(TSK_PLUGIN_URL . 'assets/trondelag-sankeri-logo.png'); ?>" alt="Trøndelag Sankeri AS" class="topbar-logo" />
            <div>
              <strong>Trøndelag Sankeri AS</strong>
              <span>Sankekart for råvarer, vekster og sopparter</span>
            </div>
          </div>
        </div>
        <form class="topbar-search" id="product-search-form">
          <label for="product-search">Søk etter vekst</label>
          <div class="search-control">
            <input id="product-search" class="search-input" type="search" placeholder="Søk f.eks. kantarell, ryllik eller skvallerkål" autocomplete="off" />
            <button id="product-search-button" class="search-button" type="submit"><span>Søk</span></button>
            <div class="topbar-active-art">
              <span>Art</span>
              <strong id="topbar-active-art">Ingen valgt</strong>
            </div>
          </div>
          <div id="topbar-product-suggestions" class="topbar-product-suggestions" aria-live="polite"></div>
        </form>
        <div class="topbar-context">
          <label class="topbar-live-toggle" for="live-mode"><input id="live-mode" type="checkbox" checked /><span>Live fra Artsdatabanken</span></label>
        </div>
      </header>
      <div class="page-shell">
        <aside class="sidebar">
          <div class="brand-block">
            <div class="brand-mark">
              <img src="<?php echo esc_url(TSK_PLUGIN_URL . 'assets/trondelag-sankeri-logo.png'); ?>" alt="Trøndelag Sankeri AS" class="brand-logo" />
              <div class="brand-copy">
                <p class="company-name">Trøndelag Sankeri AS</p>
                <p class="company-tag">Sankekart for råvarer, vekster og sopparter</p>
              </div>
            </div>
            <p class="eyebrow">Trøndelag Sankeri AS - Sankekart</p>
            <h1>Sankekart</h1>
            <p class="intro">Finn registrerte voksesteder og interne vurderinger for råvarer i sortimentet.</p>
          </div>
          <div class="helper-text">Kartet viser registrerte artsfunn. Dette er ikke en garanti for at arten finnes der akkurat nå.</div>
          <button id="mobile-filters-toggle" class="mobile-filters-toggle" type="button" aria-expanded="false">Filter og artsliste</button>
          <div id="mobile-filters-panel" class="mobile-filters-panel">
            <div class="mobile-filters-head">
              <p class="detail-kicker">Mobilvisning</p>
              <strong>Velg art og filtre</strong>
            </div>
            <div id="product-list" class="product-list" aria-live="polite"></div>
            <section id="detail-panel" class="detail-panel">
              <p class="detail-kicker">Valgt vekst</p>
              <h2>Klar for kartvisning</h2>
              <p>Klikk på en vekst i listen for å vise funn og detaljer.</p>
            </section>
            <div class="source-filter">
              <p class="field-label">Vis i kartet</p>
              <label class="toggle-row" for="show-artsdatabanken"><input id="show-artsdatabanken" type="checkbox" checked /><span>Funn fra Artsdatabanken</span></label>
              <label class="toggle-row" for="show-team-spots"><input id="show-team-spots" type="checkbox" checked /><span>Egne funn</span></label>
              <label class="toggle-row toggle-row-strong" for="show-rated-only"><input id="show-rated-only" type="checkbox" /><span>Kun funn med rating</span></label>
            </div>
            <div class="location-filter">
              <p class="field-label">Område</p>
              <div class="filter-group">
                <span class="filter-group-title">Fylke</span>
                <label class="filter-chip" for="county-trondelag"><input id="county-trondelag" class="county-filter" type="checkbox" value="Trøndelag" data-county-id="16,17" checked /><span>Trøndelag</span></label>
                <label class="filter-chip" for="county-more-romsdal"><input id="county-more-romsdal" class="county-filter" type="checkbox" value="Møre og Romsdal" data-county-id="15" /><span>Møre og Romsdal</span></label>
                <label class="filter-chip" for="county-innlandet"><input id="county-innlandet" class="county-filter" type="checkbox" value="Innlandet" data-county-id="34" /><span>Innlandet</span></label>
              </div>
            </div>
          </div>
        </aside>
        <main class="map-shell">
          <div class="map-toolbar">
            <div><p class="toolbar-label">Kartstatus</p><h2 id="map-title">Ingen vekst valgt</h2></div>
            <div class="toolbar-brand">Trøndelag Sankeri AS</div>
            <button id="reset-view" class="secondary-button" type="button">Tilbakestill kart</button>
          </div>
          <div id="status-banner" class="status-banner">Laster produktoversikt...</div>
          <section class="field-actions" aria-label="Feltmodus">
            <button id="field-register" class="field-action field-action-primary" type="button">Registrer funn</button>
            <button id="field-rated-only" class="field-action" type="button">Kun vurderte</button>
            <button id="field-reset" class="field-action" type="button">Trondheim-område</button>
          </section>
          <div class="map-stage">
            <div id="map" class="map" aria-label="Kart over registrerte artsfunn"></div>
            <button id="open-spot-panel" class="map-fab" type="button">Registrer funn</button>
            <section id="map-spot-panel" class="map-spot-panel hidden">
              <div class="map-spot-panel-head"><div><p class="detail-kicker">Nytt team-funn</p><h3>Registrer funn i kartet</h3></div><button id="close-spot-panel" class="map-spot-close" type="button">Lukk</button></div>
              <p class="spot-help">Klikk i kartet for å velge punkt, og lagre funnet slik at alle i Trøndelag Sankeri kan se det.</p>
              <form id="map-team-spot-form" class="spot-form">
                <label class="spot-label" for="map-spot-product">Art</label>
                <select id="map-spot-product" name="productId" class="spot-input product-select"></select>
                <label class="spot-label" for="map-spot-reporter">Navn</label>
                <input id="map-spot-reporter" name="reporter" class="spot-input" type="text" placeholder="F.eks. Jim" />
                <label class="spot-label" for="map-spot-rating">Rating</label>
                <select id="map-spot-rating" name="rating" class="spot-input"><option value="5">5 - Veldig lovende</option><option value="4">4 - Bra</option><option value="3">3 - Ok</option><option value="2">2 - Svakt</option><option value="1">1 - Ikke verdt turen</option></select>
                <label class="spot-label" for="map-spot-comment">Kommentar</label>
                <textarea id="map-spot-comment" name="comment" class="spot-textarea" placeholder="Skriv kort om mengde, kvalitet, adkomst eller sesong."></textarea>
                <label class="spot-label" for="map-spot-photos">Bilder</label>
                <input id="map-spot-photos" name="photos" class="spot-input" type="file" accept="image/*" multiple />
                <p class="spot-help">Legg ved opptil 3 bilder av voksested, mengde, kvalitet, adkomst eller arten.</p>
                <div class="spot-coordinates" id="map-spot-coordinates">Ingen kartposisjon valgt ennå.</div>
                <button class="spot-submit" type="submit">Lagre team-funn</button>
              </form>
            </section>
          </div>
          <section class="legend-panel map-legend-panel">
            <p class="field-label">Fargeforklaring</p>
            <div class="legend-list">
              <div class="legend-item"><span class="legend-dot legend-dot-green"></span><span>Siste 3 år</span></div>
              <div class="legend-item"><span class="legend-dot legend-dot-yellow"></span><span>2000-2022</span></div>
              <div class="legend-item"><span class="legend-dot legend-dot-pink"></span><span>Før 2000</span></div>
              <div class="legend-item"><span class="legend-dot legend-dot-team"></span><span>Egne funn</span></div>
            </div>
          </section>
          <section id="field-results" class="field-results" aria-live="polite"></section>
          <div class="map-footer"><span class="footer-chip">Trøndelag Sankeri AS</span><span class="footer-text">Sankekart basert på monday.com og Artsdatabanken</span></div>
        </main>
      </div>
    </div>
    <?php
    return ob_get_clean();
}
add_shortcode('sankekart', 'tsk_shortcode');

function tsk_register_routes() {
    register_rest_route('trondelag-sankeri/v1', '/products', ['methods' => 'GET', 'callback' => 'tsk_rest_products', 'permission_callback' => '__return_true']);
    register_rest_route('trondelag-sankeri/v1', '/species-info', ['methods' => 'GET', 'callback' => 'tsk_rest_species_info', 'permission_callback' => '__return_true']);
    register_rest_route('trondelag-sankeri/v1', '/occurrences', ['methods' => 'GET', 'callback' => 'tsk_rest_occurrences', 'permission_callback' => '__return_true']);
    register_rest_route('trondelag-sankeri/v1', '/spots', ['methods' => ['GET', 'POST'], 'callback' => 'tsk_rest_spots', 'permission_callback' => '__return_true']);
    register_rest_route('trondelag-sankeri/v1', '/occurrence-ratings', ['methods' => ['GET', 'POST'], 'callback' => 'tsk_rest_occurrence_ratings', 'permission_callback' => '__return_true']);
    register_rest_route('trondelag-sankeri/v1', '/spot-visits', ['methods' => 'POST', 'callback' => 'tsk_rest_spot_visits', 'permission_callback' => '__return_true']);
}
add_action('rest_api_init', 'tsk_register_routes');

function tsk_column_ids($settings) {
    return array_values(array_filter(array_unique([
        $settings['product_name_column_id'],
        $settings['scientific_name_column_id'],
        $settings['taxon_id_column_id'],
        $settings['season_start_column_id'],
        $settings['season_end_column_id'],
        $settings['category_column_id'],
    ])));
}

function tsk_monday_graphql($query, $variables = []) {
    $settings = tsk_settings();
    if (empty($settings['monday_api_token']) || empty($settings['monday_board_id'])) {
        return null;
    }

    $response = wp_remote_post('https://api.monday.com/v2', [
        'timeout' => 8,
        'headers' => [
            'Authorization' => $settings['monday_api_token'],
            'Content-Type' => 'application/json',
            'API-Version' => $settings['monday_api_version'],
        ],
        'body' => wp_json_encode(['query' => $query, 'variables' => $variables]),
    ]);

    if (is_wp_error($response)) {
        return null;
    }

    $payload = json_decode(wp_remote_retrieve_body($response), true);
    return empty($payload['errors']) ? ($payload['data'] ?? null) : null;
}

function tsk_fetch_monday_products() {
    $cached = get_transient('tsk_monday_products_cache');
    if (is_array($cached) && !empty($cached)) {
        return $cached;
    }

    $settings = tsk_settings();
    $query = 'query ($boardId: ID!, $columnIds: [String!]) { boards(ids: [$boardId]) { items_page(limit: 500) { cursor items { id name column_values(ids: $columnIds) { id text type value } } } } }';
    $data = tsk_monday_graphql($query, ['boardId' => $settings['monday_board_id'], 'columnIds' => tsk_column_ids($settings)]);
    $items_page = $data['boards'][0]['items_page'] ?? null;
    if (!$items_page) {
        return [];
    }

    $items = $items_page['items'] ?? [];
    $cursor = $items_page['cursor'] ?? null;
    while (!empty($cursor)) {
        $next_query = 'query ($cursor: String!, $columnIds: [String!]) { next_items_page(cursor: $cursor, limit: 500) { cursor items { id name column_values(ids: $columnIds) { id text type value } } } }';
        $next = tsk_monday_graphql($next_query, ['cursor' => $cursor, 'columnIds' => tsk_column_ids($settings)]);
        $page = $next['next_items_page'] ?? null;
        if (!$page) {
            break;
        }
        $items = array_merge($items, $page['items'] ?? []);
        $cursor = $page['cursor'] ?? null;
    }

    $products = [];
    $seen = [];
    foreach ($items as $item) {
        $product = tsk_normalize_monday_item($item, $settings);
        if (!$product) {
            continue;
        }
        $key = strtolower($product['productName'] . '|' . $product['scientificName'] . '|' . $product['taxonId']);
        if (isset($seen[$key])) {
            continue;
        }
        $seen[$key] = true;
        $products[] = $product;
    }

    usort($products, function ($a, $b) {
        return strcasecmp($a['productName'], $b['productName']);
    });
    if (!empty($products)) {
        set_transient('tsk_monday_products_cache', $products, 10 * MINUTE_IN_SECONDS);
    }

    return $products;
}

function tsk_load_supplemental_products() {
    if (!file_exists(TSK_SUPPLEMENTAL_PRODUCTS_FILE)) {
        return [];
    }

    $data = json_decode(file_get_contents(TSK_SUPPLEMENTAL_PRODUCTS_FILE), true);
    return is_array($data) ? $data : [];
}

function tsk_merge_products($primary, $supplemental) {
    $merged = [];
    $seen = [];

    foreach ([is_array($primary) ? $primary : [], is_array($supplemental) ? $supplemental : []] as $collection) {
        foreach ($collection as $product) {
            if (!is_array($product)) {
                continue;
            }

            $key = strtolower(
                trim((string)($product['taxonId'] ?? '')) . '|' .
                trim((string)($product['productName'] ?? '')) . '|' .
                trim((string)($product['scientificName'] ?? ''))
            );
            if (isset($seen[$key])) {
                continue;
            }

            $seen[$key] = true;
            $merged[] = $product;
        }
    }

    usort($merged, function ($a, $b) {
        return strcasecmp((string)($a['productName'] ?? ''), (string)($b['productName'] ?? ''));
    });

    return $merged;
}

function tsk_fetch_products_with_supplement() {
    return tsk_merge_products(tsk_fetch_monday_products(), tsk_load_supplemental_products());
}

function tsk_column_text($item, $column_id) {
    foreach (($item['column_values'] ?? []) as $value) {
        if (($value['id'] ?? '') === $column_id) {
            return trim((string)($value['text'] ?? ''));
        }
    }
    return '';
}

function tsk_taxon_id($item, $column_id) {
    foreach (($item['column_values'] ?? []) as $value) {
        if (($value['id'] ?? '') !== $column_id) {
            continue;
        }
        if (preg_match('/\d+/', (string)($value['text'] ?? ''), $match)) {
            return intval($match[0]);
        }
        if (preg_match('/\d+/', (string)($value['value'] ?? ''), $match)) {
            return intval($match[0]);
        }
    }
    return null;
}

function tsk_normalize_monday_item($item, $settings) {
    $product_name = tsk_column_text($item, $settings['product_name_column_id']) ?: trim((string)($item['name'] ?? ''));
    $scientific_name = tsk_column_text($item, $settings['scientific_name_column_id']);
    $taxon_id = tsk_taxon_id($item, $settings['taxon_id_column_id']);
    $season_start = tsk_column_text($item, $settings['season_start_column_id']);
    $season_end = tsk_column_text($item, $settings['season_end_column_id']);

    if ($product_name === '' || empty($taxon_id)) {
        return null;
    }

    return [
        'id' => 'monday-' . $item['id'],
        'mondayItemId' => (string)$item['id'],
        'productName' => $product_name,
        'scientificName' => $scientific_name ?: $product_name,
        'taxonId' => $taxon_id,
        'seasonStart' => $season_start,
        'seasonEnd' => $season_end,
        'category' => tsk_column_text($item, $settings['category_column_id']) ?: 'Ukjent',
        'sourceLabel' => 'monday.com board',
        'description' => 'Produkt hentet fra monday.com board ' . $settings['monday_board_id'] . '.',
        'sourceType' => 'monday',
    ];
}

function tsk_rest_products() {
    return rest_ensure_response(['products' => tsk_fetch_products_with_supplement(), 'source' => 'monday', 'mondayConfigured' => true]);
}

function tsk_rest_species_info(WP_REST_Request $request) {
    $taxon_id = sanitize_text_field($request->get_param('taxonId'));
    $scientific_name = sanitize_text_field($request->get_param('scientificName'));
    $product_name = sanitize_text_field($request->get_param('productName'));
    return rest_ensure_response(tsk_fetch_species_info($taxon_id, $scientific_name, $product_name));
}

function tsk_fetch_species_info($taxon_id, $scientific_name, $product_name) {
    $taxon = tsk_fetch_taxon($taxon_id, $scientific_name, $product_name);
    $image = tsk_fetch_species_image($scientific_name ?: $product_name);
    $status_tags = [];
    foreach (($taxon['TaxonTags'] ?? []) as $tag) {
        $status_tags[] = [
            'label' => trim(($tag['TagGroup'] ?? '') . ' ' . ($tag['Tag'] ?? '')),
            'tag' => $tag['Tag'] ?? '',
            'url' => $tag['Url'] ?? '',
        ];
    }

    $popular_name = $taxon['PrefferedPopularname'] ?? $product_name;
    $valid_name = $taxon['ValidScientificName'] ?? $scientific_name;
    $group = $taxon['TaxonGroup'] ?? '';
    $family = $taxon['Family'] ?? '';
    $exists = isset($taxon['ExistsInCountry']) ? (bool)$taxon['ExistsInCountry'] : null;
    $description_parts = array_filter([
        $group ? $popular_name . ' er registrert hos Artsdatabanken som ' . strtolower($group) . '.' : '',
        $family ? 'Familie: ' . $family . '.' : '',
        $exists === true ? 'Arten er oppført som finnes i Norge.' : '',
        $exists === false ? 'Artsdatabanken markerer at denne taksonen ikke er registrert som etablert i Norge.' : '',
    ]);

    return [
        'taxonId' => $taxon['TaxonId'] ?? $taxon_id,
        'popularName' => $popular_name,
        'scientificName' => $valid_name,
        'taxonGroup' => $group,
        'family' => $family,
        'status' => $taxon['Status'] ?? '',
        'statusTags' => $status_tags,
        'description' => empty($description_parts) ? 'Artsinformasjon hentes fra Artsdatabanken når den er tilgjengelig.' : implode(' ', $description_parts),
        'artsdatabankenUrl' => 'https://artsdatabanken.no/taxon/' . rawurlencode($taxon_id),
        'image' => $image,
    ];
}

function tsk_fetch_taxon($taxon_id, $scientific_name, $product_name = '') {
    $queries = array_values(array_unique(array_filter(array_map('trim', [
        (string)$scientific_name,
        (string)$product_name,
        (string)$taxon_id,
    ]))));

    foreach ($queries as $query) {
        $response = wp_remote_get(add_query_arg([
            'term' => $query,
            'take' => 8,
        ], 'https://artskart.artsdatabanken.no/publicapi/api/taxon'), ['timeout' => 8]);
        if (is_wp_error($response)) {
            continue;
        }

        $payload = json_decode(wp_remote_retrieve_body($response), true);
        if (!is_array($payload)) {
            continue;
        }

        foreach ($payload as $candidate) {
            if ((string)($candidate['TaxonId'] ?? '') === (string)$taxon_id) {
                return $candidate;
            }
        }
    }

    return [];
}

function tsk_fetch_species_image($search_term) {
    if ($search_term === '') {
        return null;
    }

    $response = wp_remote_get(add_query_arg([
        'search_api_fulltext' => $search_term,
    ], 'https://artsdatabanken.no/bilder'), ['timeout' => 20]);
    if (is_wp_error($response)) {
        return null;
    }

    $html = wp_remote_retrieve_body($response);
    if (!preg_match('/<img[^>]+src="([^"]+)"/i', $html, $image_match)) {
        return null;
    }

    $image_url = html_entity_decode($image_match[1]);
    if (strpos($image_url, '/') === 0) {
        $image_url = 'https://artsdatabanken.no' . $image_url;
    }

    $download_url = '';
    if (preg_match('/<a href="([^"]+)"[^>]+btn-download/i', $html, $download_match)) {
        $download_url = html_entity_decode($download_match[1]);
    }

    return [
        'url' => esc_url_raw($image_url),
        'downloadUrl' => esc_url_raw($download_url),
        'alt' => $search_term,
        'credit' => 'Bilde fra Artsdatabanken. Sjekk lisens før videre bruk.',
        'license' => 'Se lisens hos Artsdatabanken',
    ];
}

function tsk_rest_occurrences(WP_REST_Request $request) {
    $settings = tsk_settings();
    $products = tsk_fetch_monday_products();
    $product_id = sanitize_text_field($request->get_param('productId'));
    $product = null;
    foreach ($products as $entry) {
        if ($entry['id'] === $product_id) {
            $product = $entry;
            break;
        }
    }
    if (!$product) {
        return new WP_Error('tsk_product_not_found', 'Fant ikke produktet', ['status' => 404]);
    }

    $county_ids = tsk_csv_param($request->get_param('countyIds'), $settings['default_county_ids']);
    $county_names = tsk_csv_param($request->get_param('counties'), $settings['default_counties']);
    $municipality_names = tsk_csv_param($request->get_param('municipalities'), '');
    $occurrences = $request->get_param('live') === '1' ? tsk_fetch_occurrences($product['taxonId'], $county_ids, $county_names, $municipality_names) : [];
    $occurrences = tsk_attach_ratings($occurrences);
    $occurrences = tsk_attach_recent_visits($occurrences, 'occurrence', 'sourceId');
    $custom_spots = tsk_spots_for_product($product_id);

    return rest_ensure_response([
        'productId' => $product_id,
        'liveMode' => $request->get_param('live') === '1',
        'sourceType' => 'monday',
        'sourceLabel' => empty($occurrences) ? 'Ingen live-funn' : 'Artsdatabanken live',
        'countyFilter' => $county_names,
        'countyIdFilter' => $county_ids,
        'municipalityFilter' => $municipality_names,
        'occurrences' => $occurrences,
        'customSpots' => $custom_spots,
    ]);
}

function tsk_csv_param($value, $fallback) {
    $source = is_string($value) && $value !== '' ? $value : $fallback;
    return array_values(array_filter(array_map('trim', explode(',', $source))));
}

function tsk_fetch_occurrences($taxon_id, $county_ids, $county_names, $municipality_names = []) {
    $cache_key = 'tsk_occurrences_' . md5(wp_json_encode([$taxon_id, $county_ids, $county_names, $municipality_names]));
    $cached = get_transient($cache_key);
    if (is_array($cached)) {
        return $cached;
    }

    $exact = tsk_fetch_occurrence_pages($taxon_id, $county_ids, $county_names, $municipality_names, false);
    $result = $exact['observations'];
    $had_response = $exact['hadResponse'];
    $total_available = $exact['totalAvailable'];

    if ($had_response && $total_available < 10) {
        $with_children = tsk_fetch_occurrence_pages($taxon_id, $county_ids, $county_names, $municipality_names, true);
        if ($with_children['hadResponse'] && $with_children['totalAvailable'] > $total_available) {
            $result = $with_children['observations'];
        }
    }

    if ($had_response) {
        set_transient($cache_key, $result, 15 * MINUTE_IN_SECONDS);
    }
    return $result;
}

function tsk_fetch_occurrence_pages($taxon_id, $county_ids, $county_names, $municipality_names, $include_children) {
    $observations = [];
    $page_size = 250;
    $max_pages = 40;
    $max_occurrences = 10000;
    $target_county_ids = empty($county_ids) ? [''] : $county_ids;
    $had_response = false;
    $total_available = 0;

    foreach ($target_county_ids as $county_id) {
        $page_index = 0;

        while (true) {
            $query = [
                'pageIndex' => $page_index,
                'pageSize' => $page_size,
                'crs' => 'EPSG:4326',
                'filter.taxons' => $taxon_id,
                'filter.includeChildTaxons' => $include_children ? 'true' : 'false',
            ];
            if ($county_id !== '') {
                $query['filter.countys'] = $county_id;
            }

            $url = add_query_arg($query, 'https://artskart.artsdatabanken.no/publicapi/api/observations/list');
            $response = wp_remote_get($url, ['timeout' => 12]);
            if (is_wp_error($response)) {
                break;
            }
            $payload = json_decode(wp_remote_retrieve_body($response), true);
            if (!is_array($payload)) {
                break;
            }
            $had_response = true;
            $total_available += intval($payload['TotalCount'] ?? 0);
            $entries = $payload['Observations'] ?? [];
            if (empty($entries)) {
                break;
            }
            foreach ($entries as $entry) {
                $normalized = tsk_normalize_occurrence($entry, $county_names, $municipality_names);
                if ($normalized) {
                    $observations[] = $normalized;
                }
            }
            $page_index++;
            if (count($entries) < $page_size) {
                break;
            }
            if (($page_index * $page_size) >= intval($payload['TotalCount'] ?? 0)) {
                break;
            }
            if (count($observations) >= $max_occurrences) {
                break;
            }
            if ($page_index >= $max_pages) {
                break;
            }
        }
    }

    $seen = [];
    $deduped = array_values(array_filter($observations, function ($observation) use (&$seen) {
        $id = (string)($observation['sourceId'] ?? '');
        if ($id === '' || isset($seen[$id])) {
            return false;
        }
        $seen[$id] = true;
        return true;
    }));
    $deduped = array_slice($deduped, 0, $max_occurrences);
    return [
        'observations' => $deduped,
        'hadResponse' => $had_response,
        'totalAvailable' => $total_available,
    ];
}

function tsk_normalize_occurrence($entry, $county_names, $municipality_names = []) {
    $lat = isset($entry['Latitude']) ? floatval(str_replace(',', '.', $entry['Latitude'])) : null;
    $lng = isset($entry['Longitude']) ? floatval(str_replace(',', '.', $entry['Longitude'])) : null;
    if (!$lat || !$lng) {
        return null;
    }
    $county = (string)($entry['County'] ?? '');
    if (!empty($county_names) && !in_array($county, $county_names, true)) {
        return null;
    }
    $municipality = (string)($entry['Municipality'] ?? '');
    if (!empty($municipality_names) && !in_array($municipality, $municipality_names, true)) {
        return null;
    }
    $place_parts = array_filter(array_unique([$entry['Municipality'] ?? '', $county, $entry['Locality'] ?? '']));
    return [
        'lat' => $lat,
        'lng' => $lng,
        'place' => empty($place_parts) ? 'Ukjent sted' : implode(', ', $place_parts),
        'note' => $entry['CollectedDate'] ?? $entry['EventDate'] ?? $entry['DatasetName'] ?? 'Registrert artsfunn',
        'sourceId' => $entry['Id'] ?? $entry['id'] ?? md5(wp_json_encode($entry)),
        'municipality' => $municipality,
        'county' => $county,
        'datasetName' => $entry['DatasetName'] ?? '',
        'institution' => $entry['Institution'] ?? $entry['InstitutionName'] ?? '',
        'basisOfRecord' => $entry['BasisOfRecord'] ?? '',
        'collector' => $entry['Collector'] ?? '',
    ];
}

function tsk_attach_ratings($occurrences) {
    $ratings = get_option(TSK_OCCURRENCE_RATINGS_KEY, []);
    $index = [];
    foreach ($ratings as $rating) {
        $index[(string)$rating['sourceId']] = $rating;
    }
    foreach ($occurrences as &$occurrence) {
        $rating = $index[(string)$occurrence['sourceId']] ?? null;
        $occurrence['teamRating'] = $rating ? intval($rating['rating']) : null;
        $occurrence['teamComment'] = $rating['comment'] ?? '';
        $occurrence['teamReporter'] = $rating['reporter'] ?? '';
        $occurrence['teamRatedAt'] = $rating['createdAt'] ?? '';
    }
    return $occurrences;
}

function tsk_recent_visit($visited_at) {
    if (empty($visited_at)) {
        return false;
    }

    $timestamp = strtotime((string)$visited_at);
    if (!$timestamp) {
        return false;
    }

    return $timestamp >= (time() - (10 * DAY_IN_SECONDS));
}

function tsk_attach_recent_visits($entries, $target_type, $id_key) {
    $visits = get_option(TSK_SPOT_VISITS_KEY, []);
    $index = [];

    foreach ($visits as $visit) {
        $visit_target_type = (string)($visit['targetType'] ?? '');
        $visit_target_id = (string)($visit['targetId'] ?? '');
        if ($visit_target_type === '' || $visit_target_id === '') {
            continue;
        }

        $index[$visit_target_type . '|' . $visit_target_id] = $visit;
    }

    foreach ($entries as &$entry) {
        $entry_id = (string)($entry[$id_key] ?? '');
        $visit = $index[$target_type . '|' . $entry_id] ?? null;
        $entry['visitedAt'] = $visit ? (string)($visit['visitedAt'] ?? '') : '';
        $entry['visitedBy'] = $visit ? (string)($visit['reporter'] ?? '') : '';
        $entry['recentVisit'] = $visit ? tsk_recent_visit($visit['visitedAt'] ?? '') : false;
    }
    unset($entry);

    return $entries;
}

function tsk_spots_for_product($product_id) {
    $spots = array_values(array_filter(get_option(TSK_TEAM_SPOTS_KEY, []), function ($spot) use ($product_id) {
        return ($spot['productId'] ?? '') === $product_id;
    }));

    return tsk_attach_recent_visits($spots, 'team', 'id');
}

function tsk_rest_spots(WP_REST_Request $request) {
    if ($request->get_method() === 'GET') {
        return rest_ensure_response(['spots' => tsk_spots_for_product(sanitize_text_field($request->get_param('productId')))]);
    }

    $products = tsk_fetch_monday_products();
    $payload = $request->get_json_params();
    $product_id = sanitize_text_field($payload['productId'] ?? '');
    $product = null;
    foreach ($products as $entry) {
        if ($entry['id'] === $product_id) {
            $product = $entry;
            break;
        }
    }
    if (!$product) {
        return new WP_Error('tsk_product_not_found', 'Fant ikke produktet', ['status' => 404]);
    }

    $rating = intval($payload['rating'] ?? 0);
    if ($rating < 1 || $rating > 5) {
        return new WP_Error('tsk_rating_invalid', 'Rating må være mellom 1 og 5', ['status' => 422]);
    }

    $spot = [
        'id' => 'spot-' . time() . '-' . wp_rand(1000, 9999),
        'productId' => $product['id'],
        'productName' => $product['productName'],
        'taxonId' => $product['taxonId'],
        'scientificName' => $product['scientificName'],
        'lat' => floatval($payload['lat'] ?? 0),
        'lng' => floatval($payload['lng'] ?? 0),
        'rating' => $rating,
        'comment' => sanitize_textarea_field($payload['comment'] ?? ''),
        'reporter' => sanitize_text_field($payload['reporter'] ?? ''),
        'photos' => tsk_sanitize_spot_photos($payload['photos'] ?? []),
        'createdAt' => gmdate('c'),
    ];
    $spots = get_option(TSK_TEAM_SPOTS_KEY, []);
    $spots[] = $spot;
    update_option(TSK_TEAM_SPOTS_KEY, $spots, false);

    return rest_ensure_response(['spot' => $spot]);
}

function tsk_sanitize_spot_photos($photos) {
    if (!is_array($photos)) {
        return [];
    }

    $clean = [];
    foreach (array_slice($photos, 0, 3) as $photo) {
        if (!is_array($photo)) {
            continue;
        }
        $data_url = $photo['dataUrl'] ?? '';
        if (!is_string($data_url) || !preg_match('/^data:image\/(jpeg|jpg|png|webp|gif);base64,/i', $data_url)) {
            continue;
        }
        if (strlen($data_url) > 1500000) {
            continue;
        }
        $clean[] = [
            'name' => sanitize_file_name($photo['name'] ?? 'feltbilde'),
            'type' => sanitize_text_field($photo['type'] ?? 'image/jpeg'),
            'size' => intval($photo['size'] ?? 0),
            'dataUrl' => $data_url,
        ];
    }

    return $clean;
}

function tsk_rest_occurrence_ratings(WP_REST_Request $request) {
    if ($request->get_method() === 'GET') {
        $source_id = sanitize_text_field($request->get_param('sourceId'));
        return rest_ensure_response(['ratings' => array_values(array_filter(get_option(TSK_OCCURRENCE_RATINGS_KEY, []), function ($entry) use ($source_id) {
            return ($entry['sourceId'] ?? '') === $source_id;
        }))]);
    }

    $payload = $request->get_json_params();
    $source_id = sanitize_text_field($payload['sourceId'] ?? '');
    $rating = intval($payload['rating'] ?? 0);
    if ($source_id === '' || $rating < 1 || $rating > 5) {
        return new WP_Error('tsk_rating_invalid', 'Kilde-ID mangler eller rating er ugyldig', ['status' => 422]);
    }

    $ratings = array_values(array_filter(get_option(TSK_OCCURRENCE_RATINGS_KEY, []), function ($entry) use ($source_id) {
        return ($entry['sourceId'] ?? '') !== $source_id;
    }));
    $entry = [
        'sourceId' => $source_id,
        'rating' => $rating,
        'comment' => sanitize_textarea_field($payload['comment'] ?? ''),
        'reporter' => sanitize_text_field($payload['reporter'] ?? ''),
        'createdAt' => gmdate('c'),
    ];
    $ratings[] = $entry;
    update_option(TSK_OCCURRENCE_RATINGS_KEY, $ratings, false);

    return rest_ensure_response(['rating' => $entry]);
}

function tsk_rest_spot_visits(WP_REST_Request $request) {
    $payload = $request->get_json_params();
    $target_type = sanitize_text_field($payload['targetType'] ?? '');
    $target_id = sanitize_text_field($payload['targetId'] ?? '');
    $reporter = sanitize_text_field($payload['reporter'] ?? '');

    if (!in_array($target_type, ['occurrence', 'team'], true) || $target_id === '') {
        return new WP_Error('tsk_visit_invalid', 'Mangler gyldig funn for besøksmarkering', ['status' => 422]);
    }

    $visits = array_values(array_filter(get_option(TSK_SPOT_VISITS_KEY, []), function ($entry) use ($target_type, $target_id) {
        return (($entry['targetType'] ?? '') !== $target_type) || (($entry['targetId'] ?? '') !== $target_id);
    }));

    $entry = [
        'targetType' => $target_type,
        'targetId' => $target_id,
        'reporter' => $reporter,
        'visitedAt' => gmdate('c'),
    ];

    $visits[] = $entry;
    update_option(TSK_SPOT_VISITS_KEY, $visits, false);

    return rest_ensure_response(['visit' => array_merge($entry, ['recentVisit' => true])]);
}
