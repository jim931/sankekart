require "json"
require "net/http"
require "pathname"
require "timeout"
require "time"
require "uri"
require "cgi"
require "date"
require "webrick"

port = Integer(ENV.fetch("PORT", "3000"))
bind_address = ENV.fetch("BIND_ADDRESS", "127.0.0.1")
public_dir = Pathname.new(File.join(__dir__, "public")).realpath
products_path = Pathname.new(File.join(__dir__, "data", "products.json"))
SUPPLEMENTAL_PRODUCTS_PATH = Pathname.new(File.join(__dir__, "data", "pensum-products-supplement.json"))
MONDAY_PRODUCTS_CACHE_PATH = Pathname.new(File.join(__dir__, "data", "monday-products-cache.json"))
team_spots_path = Pathname.new(File.join(__dir__, "data", "team-spots.json"))
occurrence_ratings_path = Pathname.new(File.join(__dir__, "data", "occurrence-ratings.json"))
spot_visits_path = Pathname.new(File.join(__dir__, "data", "spot-visits.json"))
default_counties = ENV.fetch("DEFAULT_COUNTIES", "Trøndelag")
  .split(",")
  .map(&:strip)
  .reject(&:empty?)
default_county_ids = ENV.fetch("DEFAULT_COUNTY_IDS", "16,17")
  .split(",")
  .map(&:strip)
  .reject(&:empty?)
OCCURRENCE_CACHE = {}
OCCURRENCE_CACHE_TTL_SECONDS = Integer(ENV.fetch("OCCURRENCE_CACHE_TTL_SECONDS", "900"))
ARTSDATABANKEN_TIMEOUT_SECONDS = Integer(ENV.fetch("ARTSDATABANKEN_TIMEOUT_SECONDS", "8"))
fallback_occurrences = {
  "steinsopp" => [
    { lat: 59.9139, lng: 10.7522, place: "Oslo-området", note: "Eksempelfunn for prototype" },
    { lat: 60.3913, lng: 5.3221, place: "Bergen-området", note: "Eksempelfunn for prototype" },
    { lat: 63.4305, lng: 10.3951, place: "Trondheim-området", note: "Eksempelfunn for prototype" }
  ],
  "kantarell" => [
    { lat: 58.1467, lng: 7.9956, place: "Kristiansand", note: "Eksempelfunn for prototype" },
    { lat: 59.1313, lng: 11.3875, place: "Sarpsborg", note: "Eksempelfunn for prototype" }
  ],
  "ramslok" => [
    { lat: 58.969, lng: 5.7331, place: "Stavanger", note: "Eksempelfunn for prototype" },
    { lat: 59.2675, lng: 10.4076, place: "Tønsberg", note: "Eksempelfunn for prototype" }
  ]
}

mime_types = {
  ".html" => "text/html; charset=utf-8",
  ".css" => "text/css; charset=utf-8",
  ".js" => "application/javascript; charset=utf-8",
  ".json" => "application/json; charset=utf-8",
  ".png" => "image/png",
  ".jpg" => "image/jpeg",
  ".jpeg" => "image/jpeg",
  ".svg" => "image/svg+xml"
}

def load_env_file(path)
  return unless File.file?(path)

  File.readlines(path, chomp: true).each do |line|
    next if line.strip.empty? || line.strip.start_with?("#")

    key, value = line.split("=", 2)
    next if key.to_s.strip.empty? || value.nil?
    next if ENV.key?(key)

    ENV[key] = value
  end
end

load_env_file(File.join(__dir__, ".env.local"))

def load_products(products_path)
  JSON.parse(products_path.read, symbolize_names: true)
end

def load_optional_products(products_path)
  return [] unless products_path.file?

  JSON.parse(products_path.read, symbolize_names: true)
rescue JSON::ParserError
  []
end

def load_team_spots(team_spots_path)
  return [] unless team_spots_path.file?

  JSON.parse(team_spots_path.read, symbolize_names: true)
rescue JSON::ParserError
  []
end

def save_team_spots(team_spots_path, spots)
  team_spots_path.dirname.mkpath unless team_spots_path.dirname.exist?
  team_spots_path.write(JSON.pretty_generate(spots))
end

def load_occurrence_ratings(path)
  return [] unless path.file?

  JSON.parse(path.read, symbolize_names: true)
rescue JSON::ParserError
  []
end

def load_spot_visits(path)
  return [] unless path.file?

  JSON.parse(path.read, symbolize_names: true)
rescue JSON::ParserError
  []
end

def save_occurrence_ratings(path, ratings)
  path.dirname.mkpath unless path.dirname.exist?
  path.write(JSON.pretty_generate(ratings))
end

def save_spot_visits(path, visits)
  path.dirname.mkpath unless path.dirname.exist?
  path.write(JSON.pretty_generate(visits))
end

def monday_configured?
  !ENV["MONDAY_API_TOKEN"].to_s.empty? && !ENV["MONDAY_BOARD_ID"].to_s.empty?
end

def monday_headers
  {
    "Authorization" => ENV.fetch("MONDAY_API_TOKEN"),
    "Content-Type" => "application/json",
    "API-Version" => ENV.fetch("MONDAY_API_VERSION", "2025-04")
  }
end

def monday_column_ids
  [
    ENV["MONDAY_PRODUCT_NAME_COLUMN_ID"],
    ENV["MONDAY_SCIENTIFIC_NAME_COLUMN_ID"],
    ENV["MONDAY_TAXON_ID_COLUMN_ID"],
    ENV["MONDAY_CATEGORY_COLUMN_ID"],
    ENV.fetch("MONDAY_SEASON_START_COLUMN_ID", "numbers86"),
    ENV.fetch("MONDAY_SEASON_END_COLUMN_ID", "numbers67")
  ].compact.reject(&:empty?).uniq
end

def monday_graphql(query, variables = {})
  timeout_seconds = Integer(ENV.fetch("MONDAY_TIMEOUT_SECONDS", "8"))
  uri = URI("https://api.monday.com/v2")
  request = Net::HTTP::Post.new(uri)
  monday_headers.each { |key, value| request[key] = value }
  request.body = JSON.generate({ query: query, variables: variables })

  response = Net::HTTP.start(
    uri.hostname,
    uri.port,
    use_ssl: true,
    open_timeout: timeout_seconds,
    read_timeout: timeout_seconds
  ) do |http|
    http.request(request)
  end

  payload = JSON.parse(response.body)
  return payload["data"] if response.is_a?(Net::HTTPSuccess) && !payload["errors"]

  nil
rescue JSON::ParserError, StandardError
  nil
end

def load_cached_monday_products
  return nil unless MONDAY_PRODUCTS_CACHE_PATH.file?

  products = JSON.parse(MONDAY_PRODUCTS_CACHE_PATH.read, symbolize_names: true)
  products.is_a?(Array) && !products.empty? ? products : nil
rescue JSON::ParserError, StandardError
  nil
end

def save_cached_monday_products(products)
  return unless products.is_a?(Array) && !products.empty?

  MONDAY_PRODUCTS_CACHE_PATH.dirname.mkpath unless MONDAY_PRODUCTS_CACHE_PATH.dirname.exist?
  MONDAY_PRODUCTS_CACHE_PATH.write(JSON.pretty_generate(products))
rescue StandardError
  nil
end

def monday_fetch_first_page
  query = <<~GRAPHQL
    query ($boardId: ID!, $columnIds: [String!]) {
      boards(ids: [$boardId]) {
        items_page(limit: 500) {
          cursor
          items {
            id
            name
            column_values(ids: $columnIds) {
              id
              text
              type
              value
            }
          }
        }
      }
    }
  GRAPHQL

  monday_graphql(query, {
    boardId: ENV.fetch("MONDAY_BOARD_ID"),
    columnIds: monday_column_ids
  })
end

def monday_fetch_next_page(cursor)
  query = <<~GRAPHQL
    query ($cursor: String!, $columnIds: [String!]) {
      next_items_page(cursor: $cursor, limit: 500) {
        cursor
        items {
          id
          name
          column_values(ids: $columnIds) {
            id
            text
            type
            value
          }
        }
      }
    }
  GRAPHQL

  monday_graphql(query, {
    cursor: cursor,
    columnIds: monday_column_ids
  })
end

def extract_column_text(item, column_id)
  return nil if column_id.to_s.empty?

  value = item.fetch("column_values", []).find { |entry| entry["id"] == column_id }
  return nil unless value

  text = value["text"].to_s.strip
  return nil if text.empty?

  text
end

def extract_taxon_id(item)
  column_id = ENV["MONDAY_TAXON_ID_COLUMN_ID"]
  return nil if column_id.to_s.empty?

  value = item.fetch("column_values", []).find { |entry| entry["id"] == column_id }
  return nil unless value

  text_candidate = value["text"].to_s[/\d+/]
  return text_candidate.to_i if text_candidate

  raw_value = value["value"]
  return nil if raw_value.nil? || raw_value.to_s.strip.empty?

  parsed =
    begin
      JSON.parse(raw_value)
    rescue JSON::ParserError
      raw_value
    end

  if parsed.is_a?(Hash)
    candidates = [
      parsed["value"],
      parsed["number"],
      parsed["text"]
    ].compact

    match = candidates.map(&:to_s).find { |entry| entry[/\d+/] }
    return match[/\d+/].to_i if match
  end

  fallback = parsed.to_s[/\d+/]
  fallback&.to_i
end

def normalize_monday_item(item)
  product_name = extract_column_text(item, ENV["MONDAY_PRODUCT_NAME_COLUMN_ID"]) || item["name"].to_s.strip
  scientific_name = extract_column_text(item, ENV["MONDAY_SCIENTIFIC_NAME_COLUMN_ID"])
  category = extract_column_text(item, ENV["MONDAY_CATEGORY_COLUMN_ID"]) || "Ukjent"
  taxon_id = extract_taxon_id(item)
  season_start = extract_column_text(item, ENV.fetch("MONDAY_SEASON_START_COLUMN_ID", "numbers86"))
  season_end = extract_column_text(item, ENV.fetch("MONDAY_SEASON_END_COLUMN_ID", "numbers67"))

  return nil if product_name.empty?
  return nil if taxon_id.nil?

  {
    id: "monday-#{item["id"]}",
    mondayItemId: item["id"],
    productName: product_name,
    scientificName: scientific_name.to_s.empty? ? product_name : scientific_name,
    taxonId: taxon_id,
    seasonStart: season_start.to_s,
    seasonEnd: season_end.to_s,
    category: category,
    sourceLabel: "monday.com board",
    description: "Produkt hentet fra monday.com board #{ENV["MONDAY_BOARD_ID"]}.",
    sourceType: "monday"
  }
end

def fetch_monday_products
  first_page = monday_fetch_first_page
  boards = first_page&.fetch("boards", nil)
  return nil unless boards.is_a?(Array) && boards.first

  items_page = boards.first["items_page"]
  return nil unless items_page

  items = []
  items.concat(items_page.fetch("items", []))
  cursor = items_page["cursor"]

  while cursor && !cursor.empty?
    next_page = monday_fetch_next_page(cursor)
    page = next_page&.fetch("next_items_page", nil)
    break unless page

    items.concat(page.fetch("items", []))
    cursor = page["cursor"]
  end

  products = items.each_with_object([]) do |item, result|
    normalized = normalize_monday_item(item)
    result << normalized if normalized
  end

  products = products
    .uniq { |product| [product[:productName].downcase, product[:scientificName].downcase, product[:taxonId].to_s] }
    .sort_by { |product| product[:productName].downcase }
  save_cached_monday_products(products)
  products
end

def chosen_products(products_path, source_preference)
  supplemental_products = load_optional_products(SUPPLEMENTAL_PRODUCTS_PATH)

  if source_preference == "monday" && monday_configured?
    cached_products = load_cached_monday_products
    return [merge_products(cached_products, supplemental_products), "monday-cache"] if cached_products

    monday_products = fetch_monday_products
    return [merge_products(monday_products, supplemental_products), "monday"] if monday_products && !monday_products.empty?
  end

  [merge_products(load_products(products_path), supplemental_products), "local"]
end

def merge_products(primary_products, supplemental_products)
  seen = {}
  merged = []

  [Array(primary_products), Array(supplemental_products)].each do |collection|
    collection.each do |product|
      next unless product.is_a?(Hash)

      key = [
        product[:taxonId].to_s,
        product[:productName].to_s.downcase.strip,
        product[:scientificName].to_s.downcase.strip
      ].join("|")
      next if seen[key]

      seen[key] = true
      merged << product
    end
  end

  merged.sort_by { |product| product[:productName].to_s.downcase }
end

def response_json(response, payload, status: 200)
  response.status = status
  response["Content-Type"] = "application/json; charset=utf-8"
  response["Cache-Control"] = "no-store"
  response.body = JSON.pretty_generate(payload)
end

def index_html_with_initial_products(html, products_path)
  products, source = chosen_products(products_path, ENV.fetch("PRODUCT_SOURCE", "monday"))
  config = JSON.generate({ initialProducts: products, initialProductSource: source })
    .gsub("</", "<\\/")
  html.sub(
    '<script src="/app.js" type="module"></script>',
    "<script>window.TrondelagSankekart = #{config};</script>\n    <script src=\"/app.js\" type=\"module\"></script>"
  )
rescue StandardError
  html
end

def parse_float(value)
  return nil if value.nil?

  Float(value.to_s.tr(",", "."))
rescue ArgumentError, TypeError
  nil
end

def safe_query_value(value)
  text = value.to_s
  text = text.force_encoding("UTF-8")
  text = text.encode("UTF-8", invalid: :replace, undef: :replace, replace: "") unless text.valid_encoding?
  CGI.unescape(text)
end

def query_csv(request, key, fallback = [])
  source = request.query[key] ? safe_query_value(request.query[key]) : Array(fallback).join(",")
  source.split(",").map(&:strip).reject(&:empty?)
end

def build_place_name(observation)
  [observation["Municipality"], observation["County"], observation["Locality"]]
    .compact
    .reject(&:empty?)
    .uniq
    .join(", ")
end

def normalize_occurrences(payload)
  entries =
    if payload.is_a?(Array)
      payload
    elsif payload.is_a?(Hash)
      payload["Observations"] ||
        payload["observations"] ||
        payload["Items"] ||
        payload["items"] ||
        payload["Results"] ||
        payload["results"] ||
        payload["Data"] ||
        payload["data"] ||
        []
    else
      []
    end

  entries.each_with_object([]) do |observation, result|
    lat = parse_float(observation["Latitude"] || observation["latitude"])
    lng = parse_float(observation["Longitude"] || observation["longitude"])
    next unless lat && lng

    result << {
      lat: lat,
      lng: lng,
      place: build_place_name(observation).empty? ? "Ukjent sted" : build_place_name(observation),
      note: observation["CollectedDate"] || observation["EventDate"] || observation["DatasetName"] || "Registrert artsfunn",
      sourceId: observation["Id"] || observation["id"],
      municipality: observation["Municipality"] || observation["municipality"],
      county: observation["County"] || observation["county"],
      datasetName: observation["DatasetName"] || observation["datasetName"] || "",
      institution: observation["Institution"] || observation["InstitutionName"] || observation["institution"] || "",
      basisOfRecord: observation["BasisOfRecord"] || observation["basisOfRecord"] || "",
      collector: observation["Collector"] || observation["collector"] || ""
    }
  end
end

def occurrence_ratings_index(path)
  load_occurrence_ratings(path).group_by { |entry| entry[:sourceId].to_s }
end

def attach_occurrence_ratings(occurrences, path)
  ratings = occurrence_ratings_index(path)

  occurrences.map do |occurrence|
    entry = ratings[occurrence[:sourceId].to_s]&.last
    occurrence.merge(
      teamRating: entry ? entry[:rating].to_i : nil,
      teamComment: entry ? entry[:comment].to_s : "",
      teamReporter: entry ? entry[:reporter].to_s : "",
      teamRatedAt: entry ? entry[:createdAt].to_s : ""
    )
  end
end

def spot_visits_index(path)
  load_spot_visits(path).group_by { |entry| [entry[:targetType].to_s, entry[:targetId].to_s].join(":") }
end

def recent_visit?(visited_at)
  return false if visited_at.to_s.strip.empty?

  Time.parse(visited_at.to_s) >= (Time.now.utc - (10 * 24 * 60 * 60))
rescue ArgumentError
  false
end

def attach_recent_visits(entries, path, target_type:, id_key:)
  visits = spot_visits_index(path)

  entries.map do |entry|
    visit = visits[[target_type.to_s, entry[id_key].to_s].join(":")]&.last
    entry.merge(
      visitedAt: visit ? visit[:visitedAt].to_s : "",
      visitedBy: visit ? visit[:reporter].to_s : "",
      recentVisit: visit ? recent_visit?(visit[:visitedAt]) : false
    )
  end
end

def filter_occurrences_by_county(occurrences, county_names)
  names = Array(county_names).map(&:to_s).map(&:strip).reject(&:empty?)
  return occurrences if names.empty?

  occurrences.select do |occurrence|
    names.any? { |name| occurrence[:county].to_s.casecmp(name).to_i.zero? }
  end
end

def filter_occurrences_by_municipality(occurrences, municipality_names)
  names = Array(municipality_names).map(&:to_s).map(&:strip).reject(&:empty?)
  return occurrences if names.empty?

  occurrences.select do |occurrence|
    names.any? { |name| occurrence[:municipality].to_s.casecmp(name).to_i.zero? }
  end
end

def filter_occurrences_by_location(occurrences, county_names, municipality_names)
  filter_occurrences_by_municipality(
    filter_occurrences_by_county(occurrences, county_names),
    municipality_names
  )
end

def artskart_candidates(taxon_id, scientific_name)
  base = "https://artskart.artsdatabanken.no/publicapi"
  candidates = []

  if taxon_id
    candidates << [
      "#{base}/api/observations/list",
      {
        "pageIndex" => 0,
        "pageSize" => 200,
        "crs" => "EPSG:4326",
        "filter.taxons" => taxon_id,
        "filter.includeChildTaxons" => false
      }
    ]
  end

  unless scientific_name.to_s.empty?
    candidates << ["#{base}/api/taxon", { "term" => scientific_name, "take" => 10 }]
  end

  candidates
end

def fetch_json(url_string, params)
  uri = URI(url_string)
  uri.query = URI.encode_www_form(params)
  response = Timeout.timeout(ARTSDATABANKEN_TIMEOUT_SECONDS + 1) do
    Net::HTTP.start(
      uri.hostname,
      uri.port,
      use_ssl: uri.scheme == "https",
      open_timeout: ARTSDATABANKEN_TIMEOUT_SECONDS,
      read_timeout: ARTSDATABANKEN_TIMEOUT_SECONDS
    ) { |http| http.get(uri.request_uri) }
  end
  return nil unless response.is_a?(Net::HTTPSuccess)

  JSON.parse(response.body)
rescue JSON::ParserError, StandardError
  nil
end

def fetch_text(url_string, params)
  uri = URI(url_string)
  uri.query = URI.encode_www_form(params)
  response = Timeout.timeout(ARTSDATABANKEN_TIMEOUT_SECONDS + 1) do
    Net::HTTP.start(
      uri.hostname,
      uri.port,
      use_ssl: uri.scheme == "https",
      open_timeout: ARTSDATABANKEN_TIMEOUT_SECONDS,
      read_timeout: ARTSDATABANKEN_TIMEOUT_SECONDS
    ) { |http| http.get(uri.request_uri) }
  end
  return nil unless response.is_a?(Net::HTTPSuccess)

  response.body
rescue StandardError
  nil
end

def fetch_taxon_info(taxon_id, scientific_name, product_name = nil)
  [scientific_name, product_name, taxon_id].map(&:to_s).map(&:strip).reject(&:empty?).uniq.each do |query|
    payload = fetch_json("https://artskart.artsdatabanken.no/publicapi/api/taxon", {
      "term" => query,
      "take" => 8
    })
    next unless payload.is_a?(Array) && !payload.empty?

    match = payload.find { |candidate| candidate["TaxonId"].to_s == taxon_id.to_s }
    return match if match
  end

  {}
end

def fetch_species_image(search_term)
  html = fetch_text("https://artsdatabanken.no/bilder", {
    "search_api_fulltext" => search_term
  })
  return nil unless html

  image_url = html[/<img[^>]+src="([^"]+)"/i, 1]
  return nil unless image_url

  image_url = image_url.gsub("&amp;", "&")
  image_url = "https://artsdatabanken.no#{image_url}" if image_url.start_with?("/")
  download_url = html[/<a href="([^"]+)"[^>]+btn-download/i, 1].to_s.gsub("&amp;", "&")

  {
    url: image_url,
    downloadUrl: download_url,
    alt: search_term,
    credit: "Bilde fra Artsdatabanken. Sjekk lisens før videre bruk.",
    license: "Se lisens hos Artsdatabanken"
  }
end

def build_species_info(taxon_id:, scientific_name:, product_name:)
  taxon = fetch_taxon_info(taxon_id, scientific_name, product_name)
  tags = Array(taxon["TaxonTags"]).map do |tag|
    {
      label: [tag["TagGroup"], tag["Tag"]].compact.join(" "),
      tag: tag["Tag"],
      url: tag["Url"]
    }
  end
  popular_name = taxon["PrefferedPopularname"] || product_name
  group = taxon["TaxonGroup"].to_s
  family = taxon["Family"].to_s
  description_parts = [
    group.empty? ? nil : "#{popular_name} er registrert hos Artsdatabanken som #{group.downcase}.",
    family.empty? ? nil : "Familie: #{family}.",
    taxon.key?("ExistsInCountry") && taxon["ExistsInCountry"] ? "Arten er oppført som finnes i Norge." : nil,
    taxon.key?("ExistsInCountry") && !taxon["ExistsInCountry"] ? "Artsdatabanken markerer at denne taksonen ikke er registrert som etablert i Norge." : nil
  ].compact

  {
    taxonId: taxon["TaxonId"] || taxon_id,
    popularName: popular_name,
    scientificName: taxon["ValidScientificName"] || scientific_name,
    taxonGroup: group,
    family: family,
    status: taxon["Status"].to_s,
    statusTags: tags,
    description: description_parts.empty? ? "Artsinformasjon hentes fra Artsdatabanken når den er tilgjengelig." : description_parts.join(" "),
    artsdatabankenUrl: "https://artsdatabanken.no/taxon/#{taxon_id}",
    image: fetch_species_image(scientific_name.to_s.empty? ? product_name : scientific_name)
  }
end

def fetch_all_observations_by_taxon(taxon_id, county_names: [], county_ids: [], municipality_names: [], max_total: nil)
  cache_key = [
    taxon_id.to_s,
    county_names.join("|"),
    county_ids.join("|"),
    municipality_names.join("|"),
    max_total.to_s
  ].join("::")
  cached = OCCURRENCE_CACHE[cache_key]
  return cached[:data] if cached && Time.now - cached[:stored_at] < OCCURRENCE_CACHE_TTL_SECONDS

  page_size = Integer(ENV.fetch("ARTSDATABANKEN_PAGE_SIZE", "250"))
  max_pages = Integer(ENV.fetch("ARTSDATABANKEN_MAX_PAGES", "40"))
  practical_limit = max_total || Integer(ENV.fetch("ARTSDATABANKEN_MAX_OCCURRENCES", "10000"))
  target_county_ids = county_ids.empty? ? [nil] : county_ids

  fetch_pages = lambda do |include_children|
    observations = []
    had_response = false
    total_available = 0

    target_county_ids.each do |county_id|
      page_index = 0

      loop do
        query = {
          "pageIndex" => page_index,
          "pageSize" => page_size,
          "crs" => "EPSG:4326",
          "filter.taxons" => taxon_id,
          "filter.includeChildTaxons" => include_children
        }
        query["filter.countys"] = county_id if county_id

        payload = fetch_json("https://artskart.artsdatabanken.no/publicapi/api/observations/list", query)
        break unless payload
        had_response = true

        total_count = payload["TotalCount"].to_i
        total_available += total_count
        normalized = normalize_occurrences(payload)
        batch = filter_occurrences_by_location(normalized, county_names, municipality_names)
        observations.concat(batch)

        page_index += 1

        break if normalized.length < page_size
        break if page_index * page_size >= total_count
        break if observations.length >= practical_limit
        break if page_index >= max_pages
      end

      break if observations.length >= practical_limit
    end

    [observations.first(practical_limit), had_response, total_available]
  end

  result, had_response, total_available = fetch_pages.call(false)
  if had_response && total_available < 10
    child_result, child_had_response, child_total_available = fetch_pages.call(true)
    if child_had_response && child_total_available > total_available
      result = child_result
      total_available = child_total_available
    end
  end

  OCCURRENCE_CACHE[cache_key] = { data: result, stored_at: Time.now } if had_response
  result
end

def fetch_live_occurrences(product, county_names: [], county_ids: [], municipality_names: [], ratings_path:)
  normalized = fetch_all_observations_by_taxon(
    product[:taxonId],
    county_names: county_names,
    county_ids: county_ids,
    municipality_names: municipality_names
  )
  return [attach_occurrence_ratings(normalized, ratings_path), "Artsdatabanken live"] unless normalized.empty?

  [[], nil]
end

def normalize_team_spot(spot)
  {
    id: spot[:id],
    productId: spot[:productId],
    productName: spot[:productName],
    taxonId: spot[:taxonId],
    scientificName: spot[:scientificName],
    lat: spot[:lat].to_f,
    lng: spot[:lng].to_f,
    rating: spot[:rating].to_i,
    comment: spot[:comment].to_s,
    reporter: spot[:reporter].to_s,
    photos: Array(spot[:photos]),
    createdAt: spot[:createdAt].to_s
  }
end

def sanitize_spot_photos(photos)
  return [] unless photos.is_a?(Array)

  photos.first(3).each_with_object([]) do |photo, result|
    next unless photo.is_a?(Hash)

    data_url = photo[:dataUrl].to_s
    next unless data_url.match?(%r{\Adata:image/(jpeg|jpg|png|webp|gif);base64,}i)
    next if data_url.length > 1_500_000

    result << {
      name: File.basename(photo[:name].to_s.empty? ? "feltbilde" : photo[:name].to_s),
      type: photo[:type].to_s,
      size: photo[:size].to_i,
      dataUrl: data_url
    }
  end
end

def team_spots_for_product(team_spots_path, product_id)
  load_team_spots(team_spots_path)
    .select { |spot| spot[:productId] == product_id }
    .map { |spot| normalize_team_spot(spot) }
end

def parse_request_json(request)
  return {} if request.body.to_s.strip.empty?

  JSON.parse(request.body, symbolize_names: true)
rescue JSON::ParserError
  nil
end

def build_team_spot(payload, product)
  lat = parse_float(payload[:lat])
  lng = parse_float(payload[:lng])
  rating = payload[:rating].to_i

  return [nil, "Koordinater mangler eller er ugyldige"] unless lat && lng
  return [nil, "Rating må være mellom 1 og 5"] unless (1..5).include?(rating)

  comment = payload[:comment].to_s.strip
  reporter = payload[:reporter].to_s.strip

  [
    {
      id: "spot-#{Time.now.to_i}-#{rand(1000..9999)}",
      productId: product[:id],
      productName: product[:productName],
      taxonId: product[:taxonId],
      scientificName: product[:scientificName],
      lat: lat,
      lng: lng,
      rating: rating,
      comment: comment,
      reporter: reporter,
      photos: sanitize_spot_photos(payload[:photos]),
      createdAt: Time.now.utc.iso8601
    },
    nil
  ]
end

server = WEBrick::HTTPServer.new(
  Port: port,
  BindAddress: bind_address,
  AccessLog: [],
  Logger: WEBrick::Log.new($stdout, WEBrick::Log::WARN)
)

server.mount_proc "/api/products" do |_request, response|
  products, source = chosen_products(products_path, ENV.fetch("PRODUCT_SOURCE", "monday"))
  response_json(response, {
    products: products,
    source: source,
    mondayConfigured: monday_configured?
  })
end

server.mount_proc "/api/species-info" do |request, response|
  response_json(response, build_species_info(
    taxon_id: request.query["taxonId"].to_s,
    scientific_name: request.query["scientificName"].to_s,
    product_name: request.query["productName"].to_s
  ))
end

server.mount_proc "/api/occurrences" do |request, response|
  products, = chosen_products(products_path, ENV.fetch("PRODUCT_SOURCE", "monday"))
  product_id = request.query["productId"]
  use_live = request.query["live"] == "1" || ENV["ARTSDATABANKEN_LIVE"] == "1"
  county_names = query_csv(request, "counties", default_counties)
  county_ids = query_csv(request, "countyIds", default_county_ids)
  municipality_names = query_csv(request, "municipalities")
  product = products.find { |entry| entry[:id] == product_id }

  unless product
    response_json(response, { error: "Fant ikke produktet" }, status: 404)
    next
  end

  live_occurrences = []
  source_label = nil

  if use_live
    live_occurrences, source_label = fetch_live_occurrences(
      product,
      county_names: county_names,
      county_ids: county_ids,
      municipality_names: municipality_names,
      ratings_path: occurrence_ratings_path
    )
  end

  fallback = fallback_occurrences.fetch(product_id, [])
  occurrences = live_occurrences.empty? ? fallback : live_occurrences
  occurrences = attach_recent_visits(occurrences, spot_visits_path, target_type: "occurrence", id_key: :sourceId)
  custom_spots = attach_recent_visits(team_spots_for_product(team_spots_path, product_id), spot_visits_path, target_type: "team", id_key: :id)

  response_json(
    response,
    {
      productId: product_id,
      liveMode: use_live,
      sourceType: product[:sourceType] || "local",
      sourceLabel: source_label || "Prøvedata",
      countyFilter: county_names,
      countyIdFilter: county_ids,
      municipalityFilter: municipality_names,
      occurrences: occurrences,
      customSpots: custom_spots,
      integrationNote: "Artsdatabanken-kallet henter sidevis fra Artskart og kan ta litt tid for artsgrupper med mange underliggende takson."
    }
  )
end

server.mount_proc "/api/spots" do |request, response|
  products, = chosen_products(products_path, ENV.fetch("PRODUCT_SOURCE", "monday"))

  if request.request_method == "GET"
    product_id = request.query["productId"]
    response_json(response, { spots: team_spots_for_product(team_spots_path, product_id) })
    next
  end

  unless request.request_method == "POST"
    response_json(response, { error: "Metoden støttes ikke" }, status: 405)
    next
  end

  payload = parse_request_json(request)
  if payload.nil?
    response_json(response, { error: "Ugyldig JSON" }, status: 400)
    next
  end

  product = products.find { |entry| entry[:id] == payload[:productId].to_s }
  unless product
    response_json(response, { error: "Fant ikke produktet" }, status: 404)
    next
  end

  spot, error_message = build_team_spot(payload, product)
  if error_message
    response_json(response, { error: error_message }, status: 422)
    next
  end

  spots = load_team_spots(team_spots_path)
  spots << spot
  save_team_spots(team_spots_path, spots)

  response_json(response, { spot: normalize_team_spot(spot) }, status: 201)
end

server.mount_proc "/api/occurrence-ratings" do |request, response|
  if request.request_method == "GET"
    source_id = request.query["sourceId"].to_s
    ratings = load_occurrence_ratings(occurrence_ratings_path)
    response_json(response, {
      ratings: ratings.select { |entry| entry[:sourceId].to_s == source_id }
    })
    next
  end

  unless request.request_method == "POST"
    response_json(response, { error: "Metoden støttes ikke" }, status: 405)
    next
  end

  payload = parse_request_json(request)
  if payload.nil?
    response_json(response, { error: "Ugyldig JSON" }, status: 400)
    next
  end

  source_id = payload[:sourceId].to_s.strip
  rating = payload[:rating].to_i
  comment = payload[:comment].to_s.strip
  reporter = payload[:reporter].to_s.strip

  if source_id.empty?
    response_json(response, { error: "Kilde-ID mangler" }, status: 422)
    next
  end

  unless (1..5).include?(rating)
    response_json(response, { error: "Rating må være mellom 1 og 5" }, status: 422)
    next
  end

  ratings = load_occurrence_ratings(occurrence_ratings_path)
  ratings.reject! { |entry| entry[:sourceId].to_s == source_id }
  entry = {
    sourceId: source_id,
    rating: rating,
    comment: comment,
    reporter: reporter,
    createdAt: Time.now.utc.iso8601
  }
  ratings << entry
  save_occurrence_ratings(occurrence_ratings_path, ratings)

  response_json(response, { rating: entry }, status: 201)
end

server.mount_proc "/api/spot-visits" do |request, response|
  unless request.request_method == "POST"
    response_json(response, { error: "Metoden støttes ikke" }, status: 405)
    next
  end

  payload = parse_request_json(request)
  if payload.nil?
    response_json(response, { error: "Ugyldig JSON" }, status: 400)
    next
  end

  target_type = payload[:targetType].to_s.strip
  target_id = payload[:targetId].to_s.strip
  reporter = payload[:reporter].to_s.strip

  unless %w[occurrence team].include?(target_type)
    response_json(response, { error: "Ugyldig måltype" }, status: 422)
    next
  end

  if target_id.empty?
    response_json(response, { error: "Mål-ID mangler" }, status: 422)
    next
  end

  visits = load_spot_visits(spot_visits_path)
  visits.reject! { |entry| entry[:targetType].to_s == target_type && entry[:targetId].to_s == target_id }
  entry = {
    targetType: target_type,
    targetId: target_id,
    reporter: reporter,
    visitedAt: Time.now.utc.iso8601
  }
  visits << entry
  save_spot_visits(spot_visits_path, visits)

  response_json(response, { visit: entry.merge(recentVisit: true) }, status: 201)
end

server.mount_proc "/" do |request, response|
  relative = request.path == "/" ? "/index.html" : request.path
  candidate = public_dir.join(relative.delete_prefix("/")).cleanpath

  unless candidate.to_s.start_with?(public_dir.to_s) && candidate.file?
    response.status = 404
    response["Content-Type"] = "text/plain; charset=utf-8"
    response.body = "Fant ikke filen"
    next
  end

  response.status = 200
  response["Content-Type"] = mime_types.fetch(candidate.extname.downcase, "application/octet-stream")
  response["Cache-Control"] = "no-store"
  response.body = candidate.basename.to_s == "index.html" ? index_html_with_initial_products(candidate.read, products_path) : candidate.binread
end

trap("INT") { server.shutdown }

puts "Vekstkart kjører på http://#{bind_address}:#{port}"
server.start
