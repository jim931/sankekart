require "json"
require "net/http"
require "pathname"
require "time"
require "uri"
require "webrick"

port = Integer(ENV.fetch("PORT", "3000"))
bind_address = ENV.fetch("BIND_ADDRESS", "127.0.0.1")
public_dir = Pathname.new(File.join(__dir__, "public")).realpath
products_path = Pathname.new(File.join(__dir__, "data", "products.json"))
team_spots_path = Pathname.new(File.join(__dir__, "data", "team-spots.json"))
occurrence_ratings_path = Pathname.new(File.join(__dir__, "data", "occurrence-ratings.json"))
default_counties = ENV.fetch("DEFAULT_COUNTIES", "Trøndelag")
  .split(",")
  .map(&:strip)
  .reject(&:empty?)
default_county_ids = ENV.fetch("DEFAULT_COUNTY_IDS", "50")
  .split(",")
  .map(&:strip)
  .reject(&:empty?)

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
  ".json" => "application/json; charset=utf-8"
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

def save_occurrence_ratings(path, ratings)
  path.dirname.mkpath unless path.dirname.exist?
  path.write(JSON.pretty_generate(ratings))
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
    ENV["MONDAY_CATEGORY_COLUMN_ID"]
  ].compact.reject(&:empty?).uniq
end

def monday_graphql(query, variables = {})
  uri = URI("https://api.monday.com/v2")
  request = Net::HTTP::Post.new(uri)
  monday_headers.each { |key, value| request[key] = value }
  request.body = JSON.generate({ query: query, variables: variables })

  response = Net::HTTP.start(uri.hostname, uri.port, use_ssl: true) do |http|
    http.request(request)
  end

  payload = JSON.parse(response.body)
  return payload["data"] if response.is_a?(Net::HTTPSuccess) && !payload["errors"]

  nil
rescue JSON::ParserError, StandardError
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

  return nil if product_name.empty?
  return nil if taxon_id.nil?
  return nil if scientific_name.to_s.empty?

  {
    id: "monday-#{item["id"]}",
    mondayItemId: item["id"],
    productName: product_name,
    scientificName: scientific_name.to_s.empty? ? product_name : scientific_name,
    taxonId: taxon_id,
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

  products
    .uniq { |product| [product[:productName].downcase, product[:scientificName].downcase, product[:taxonId].to_s] }
    .sort_by { |product| product[:productName].downcase }
end

def chosen_products(products_path, source_preference)
  if source_preference == "monday" && monday_configured?
    monday_products = fetch_monday_products
    return [monday_products, "monday"] if monday_products && !monday_products.empty?
  end

  [load_products(products_path), "local"]
end

def response_json(response, payload, status: 200)
  response.status = status
  response["Content-Type"] = "application/json; charset=utf-8"
  response.body = JSON.pretty_generate(payload)
end

def parse_float(value)
  return nil if value.nil?

  Float(value.to_s.tr(",", "."))
rescue ArgumentError, TypeError
  nil
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
      county: observation["County"] || observation["county"]
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

def filter_occurrences_by_county(occurrences, county_names)
  names = Array(county_names).map(&:to_s).map(&:strip).reject(&:empty?)
  return occurrences if names.empty?

  occurrences.select do |occurrence|
    names.any? { |name| occurrence[:county].to_s.casecmp(name).zero? }
  end
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
  response = Net::HTTP.get_response(uri)
  return nil unless response.is_a?(Net::HTTPSuccess)

  JSON.parse(response.body)
rescue JSON::ParserError, StandardError
  nil
end

def fetch_all_observations_by_taxon(taxon_id, county_names: [], county_ids: [], max_total: nil)
  observations = []
  page_index = 0
  page_size = 1000

  loop do
    payload = fetch_json("https://artskart.artsdatabanken.no/publicapi/api/observations/list", {
      "pageIndex" => page_index,
      "pageSize" => page_size,
      "crs" => "EPSG:4326",
      "filter.taxons" => taxon_id,
      "filter.includeChildTaxons" => false,
      "filter.countys" => county_ids
    })
    break unless payload

    batch = filter_occurrences_by_county(normalize_occurrences(payload), county_names)
    observations.concat(batch)

    total_count = payload["TotalCount"].to_i
    page_index += 1

    break if batch.empty?
    break if observations.length >= total_count
    break if max_total && observations.length >= max_total
  end

  max_total ? observations.first(max_total) : observations
end

def fetch_live_occurrences(product, county_names: [], county_ids: [], ratings_path:)
  artskart_candidates(product[:taxonId], product[:scientificName]).each do |url, params|
    payload = fetch_json(url, params)
    next unless payload

    if url.include?("/api/taxon")
      taxa =
        if payload.is_a?(Array)
          payload
        elsif payload.is_a?(Hash)
          payload["Items"] || payload["items"] || payload["Results"] || payload["results"] || []
        else
          []
        end

      match = taxa.find do |candidate|
        candidate["TaxonId"].to_s == product[:taxonId].to_s ||
          candidate["ValidScientificName"].to_s.casecmp(product[:scientificName].to_s).zero?
      end

      next unless match

      normalized = fetch_all_observations_by_taxon(
        match["TaxonId"],
        county_names: county_names,
        county_ids: county_ids
      )
      return [attach_occurrence_ratings(normalized, ratings_path), "Artsdatabanken live"] unless normalized.empty?
      next
    end

    normalized =
      if params["filter.taxons"]
        fetch_all_observations_by_taxon(
          params["filter.taxons"],
          county_names: county_names,
          county_ids: county_ids
        )
      else
        filter_occurrences_by_county(normalize_occurrences(payload), county_names)
      end
    return [attach_occurrence_ratings(normalized, ratings_path), "Artsdatabanken live"] unless normalized.empty?
  end

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
    createdAt: spot[:createdAt].to_s
  }
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

server.mount_proc "/api/occurrences" do |request, response|
  products, = chosen_products(products_path, ENV.fetch("PRODUCT_SOURCE", "monday"))
  product_id = request.query["productId"]
  use_live = request.query["live"] == "1" || ENV["ARTSDATABANKEN_LIVE"] == "1"
  county_names =
    if request.query["counties"]
      request.query["counties"].split(",").map(&:strip).reject(&:empty?)
    else
      default_counties
    end
  county_ids =
    if request.query["countyIds"]
      request.query["countyIds"].split(",").map(&:strip).reject(&:empty?)
    else
      default_county_ids
    end
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
      ratings_path: occurrence_ratings_path
    )
  end

  fallback = fallback_occurrences.fetch(product_id, [])
  occurrences = live_occurrences.empty? ? fallback : live_occurrences
  custom_spots = team_spots_for_product(team_spots_path, product_id)

  response_json(
    response,
    {
      productId: product_id,
      liveMode: use_live,
      sourceType: product[:sourceType] || "local",
      sourceLabel: source_label || "Prøvedata",
      countyFilter: county_names,
      countyIdFilter: county_ids,
      occurrences: occurrences,
      customSpots: custom_spots,
      integrationNote: "Artsdatabanken-kallet er implementert med beste gjetning mot dokumenterte endepunkter og kan kreve en liten parameterjustering når det kjøres live."
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
  response.body = candidate.binread
end

trap("INT") { server.shutdown }

puts "Vekstkart kjører på http://#{bind_address}:#{port}"
server.start
