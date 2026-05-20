import { z } from "zod";
import type { ServerState, ToolVersion } from "./state.js";
import { slowModeDelay } from "./state.js";
import { listContacts, getContact, getContactByEmail, searchContacts, createContact, deleteContact, updateContactField } from "./db.js";

interface ToolDef {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, z.ZodType>;
  handler: (args: Record<string, unknown>) => Promise<{ content: Array<{ type: "text"; text: string }> }>;
}

function textResult(text: string) {
  return { content: [{ type: "text" as const, text }] };
}


const echoV1: ToolDef = {
  name: "echo",
  title: "Echo Message",
  description: "Echoes back the provided message verbatim as plain text.",
  inputSchema: {
    message: z.string().describe("The message to echo back."),
  },
  handler: async (args) => { await slowModeDelay(); return textResult(String(args.message)); },
};

const echoV2: ToolDef = {
  name: "echo",
  title: "Echo Message (Formatted)",
  description:
    "Echoes back the provided message in the chosen format: 'plain' returns it unchanged, " +
    "'json' wraps it as {\"echo\": \"...\"}, 'uppercase' converts to uppercase.",
  inputSchema: {
    message: z.string().describe("The message to echo back."),
    format: z.enum(["plain", "json", "uppercase"]).describe(
      "Output format: 'plain', 'json', or 'uppercase'."
    ),
  },
  handler: async (args) => {
    await slowModeDelay();
    const msg = String(args.message);
    const fmt = String(args.format);
    if (fmt === "json") return textResult(JSON.stringify({ echo: msg }));
    if (fmt === "uppercase") return textResult(msg.toUpperCase());
    return textResult(msg);
  },
};

const addV1: ToolDef = {
  name: "add",
  title: "Add Two Numbers",
  description: "Returns the sum of two numbers.",
  inputSchema: {
    a: z.number().describe("First number."),
    b: z.number().describe("Second number."),
  },
  handler: async (args) => { await slowModeDelay(); return textResult(String(Number(args.a) + Number(args.b))); },
};

const addV2: ToolDef = {
  name: "add",
  title: "Sum Number Array",
  description: "Returns the sum of an array of numbers. An empty array returns 0.",
  inputSchema: {
    numbers: z.array(z.number()).describe("Numbers to sum."),
  },
  handler: async (args) => {
    await slowModeDelay();
    const nums = args.numbers as number[];
    return textResult(String(nums.reduce((s, n) => s + n, 0)));
  },
};

const getTime: ToolDef = {
  name: "get-time",
  title: "Get Current Time",
  description: "Returns the current server time as an ISO 8601 string (e.g. '2025-01-30T14:30:00.000Z').",
  inputSchema: {},
  handler: async () => { await slowModeDelay(); return textResult(new Date().toISOString()); },
};

const randomNumber: ToolDef = {
  name: "random-number",
  title: "Generate Random Number",
  description:
    "Generates a cryptographically non-secure pseudo-random integer within the specified " +
    "inclusive range [min, max]. Both bounds must be integers. The result is uniformly " +
    "distributed across all integers from min to max, inclusive of both endpoints. For " +
    "example, with min=1 and max=6, this simulates a standard six-sided die roll. The " +
    "random number is generated using Math.random() and Math.floor(), which is suitable " +
    "for testing purposes but should not be used for security-sensitive applications. " +
    "This tool is useful for testing MCP tool calls with integer-typed parameters and " +
    "for verifying that the client correctly validates integer constraints. If min equals " +
    "max, the result is always that value. If min is greater than max, the behavior is " +
    "undefined (may return values outside the expected range).",
  inputSchema: {
    min: z.number().int().describe(
      "The lower bound of the random range (inclusive). Must be an integer. " +
      "For example, 1 for a standard die roll."
    ),
    max: z.number().int().describe(
      "The upper bound of the random range (inclusive). Must be an integer. " +
      "Should be greater than or equal to min. For example, 6 for a standard die roll."
    ),
  },
  handler: async (args) => {
    await slowModeDelay();
    const min = Number(args.min);
    const max = Number(args.max);
    const result = Math.floor(Math.random() * (max - min + 1)) + min;
    return textResult(String(result));
  },
};

const reverse: ToolDef = {
  name: "reverse",
  title: "Reverse String",
  description:
    "Reverses the characters in the provided input string and returns the result. This tool " +
    "performs a simple Unicode-aware string reversal by splitting the input into an array of " +
    "characters, reversing their order, and joining them back into a string. For example, " +
    "'hello' becomes 'olleh' and 'abcdef' becomes 'fedcba'. This tool is useful for testing " +
    "MCP tool invocations where the output is deterministically derived from the input, making " +
    "it easy to verify correct behavior in automated tests. Unlike echo, the output is always " +
    "different from the input (unless the string is a palindrome), which makes it straightforward " +
    "to confirm that the tool actually executed rather than the client returning a cached or " +
    "passthrough result. Empty strings return an empty string. Multi-byte Unicode characters " +
    "such as emoji are handled correctly via Array.from() which splits on code points rather " +
    "than UTF-16 code units.",
  inputSchema: {
    text: z.string().describe(
      "The string to reverse. Can contain any valid UTF-8 text including whitespace, " +
      "newlines, special characters, emoji, and multi-byte Unicode sequences. The reversal " +
      "operates on Unicode code points, so surrogate pairs are preserved."
    ),
  },
  handler: async (args) => {
    await slowModeDelay();
    return textResult(Array.from(String(args.text)).reverse().join(""));
  },
};

const versionedTools: Record<string, Record<ToolVersion, ToolDef>> = {
  echo: { v1: echoV1, v2: echoV2 },
  add: { v1: addV1, v2: addV2 },
};

const listContactsTool: ToolDef = {
  name: "list-contacts",
  title: "List All Contacts",
  description:
    "Returns all contacts from the database as a JSON array, ordered by ID. Each contact has " +
    "id, name, email, company, notes, and created_at fields. Returns an empty array if no " +
    "contacts exist.",
  inputSchema: {},
  handler: async () => {
    await slowModeDelay();
    return textResult(JSON.stringify(listContacts(), null, 2));
  },
};

const getContactByIdTool: ToolDef = {
  name: "get-contact-by-id",
  title: "Get Contact by ID",
  description:
    "Returns a single contact by its numeric ID as a JSON object. Returns an error message " +
    "if no contact with the given ID exists.",
  inputSchema: {
    id: z.number().int().describe("The ID of the contact to retrieve."),
  },
  handler: async (args) => {
    await slowModeDelay();
    const contact = getContact(Number(args.id));
    if (!contact) return textResult(`Error: no contact with id ${args.id}`);
    return textResult(JSON.stringify(contact, null, 2));
  },
};

const getContactByEmailTool: ToolDef = {
  name: "get-contact-by-email",
  title: "Get Contact by Email",
  description:
    "Returns a single contact by exact email address as a JSON object. The match is exact " +
    "(case-sensitive). Returns an error message if no contact with the given email exists.",
  inputSchema: {
    email: z.string().describe("The exact email address to look up, e.g. 'alice@acme.com'."),
  },
  handler: async (args) => {
    await slowModeDelay();
    const contact = getContactByEmail(String(args.email));
    if (!contact) return textResult(`Error: no contact with email ${args.email}`);
    return textResult(JSON.stringify(contact, null, 2));
  },
};

const searchContactsTool: ToolDef = {
  name: "search-contacts",
  title: "Search Contacts",
  description:
    "Searches contacts by a query string. Case-insensitive substring match against name, " +
    "email, company, and notes fields. Returns a JSON array of matching contacts, or an " +
    "empty array if none match.",
  inputSchema: {
    query: z.string().describe("Search term to match against name, email, company, and notes."),
  },
  handler: async (args) => {
    await slowModeDelay();
    return textResult(JSON.stringify(searchContacts(String(args.query)), null, 2));
  },
};

const createContactTool: ToolDef = {
  name: "create-contact",
  title: "Create Contact",
  description:
    "Creates a new contact and returns the created record with its auto-generated ID and " +
    "timestamp. Requires name and email. Company and notes are optional.",
  inputSchema: {
    name: z.string().describe("Full name, e.g. 'Jane Doe'."),
    email: z.string().describe("Email address, e.g. 'jane@example.com'."),
    company: z.string().optional().describe("Company name. Optional."),
    notes: z.string().optional().describe("Free-text notes. Optional."),
  },
  handler: async (args) => {
    await slowModeDelay();
    const contact = createContact(
      String(args.name),
      String(args.email),
      String(args.company ?? ""),
      String(args.notes ?? ""),
    );
    return textResult(JSON.stringify(contact, null, 2));
  },
};

const updateContactTool: ToolDef = {
  name: "update-contact",
  title: "Update Contact",
  description:
    "Updates a single field on a contact. Specify the contact ID, which field to change " +
    "(name, email, company, or notes), and the new value. Returns the full updated contact. " +
    "To update multiple fields, call this tool once per field.",
  inputSchema: {
    id: z.number().int().describe("The ID of the contact to update."),
    field: z.enum(["name", "email", "company", "notes"]).describe("Which field to update."),
    value: z.string().describe("The new value for the field."),
  },
  handler: async (args) => {
    await slowModeDelay();
    const updated = updateContactField(
      Number(args.id),
      String(args.field) as "name" | "email" | "company" | "notes",
      String(args.value),
    );
    if (!updated) return textResult(`Error: no contact with id ${args.id}`);
    return textResult(JSON.stringify(updated, null, 2));
  },
};

const deleteContactTool: ToolDef = {
  name: "delete-contact",
  title: "Delete Contact",
  description:
    "Permanently deletes a contact by ID. Returns a confirmation message or an error if " +
    "the ID doesn't exist. This cannot be undone.",
  inputSchema: {
    id: z.number().int().describe("The ID of the contact to delete."),
  },
  handler: async (args) => {
    await slowModeDelay();
    const deleted = deleteContact(Number(args.id));
    if (!deleted) return textResult(`Error: no contact with id ${args.id}`);
    return textResult(`Deleted contact ${args.id}`);
  },
};

const submitCustomsDeclarationTool: ToolDef = {
  name: "submit-customs-declaration",
  title: "Submit Customs Declaration",
  description:
    "Submits an international shipping customs declaration (CN23 / commercial invoice equivalent). " +
    "Requires complete shipper, recipient, package, commercial, and compliance details. All fields " +
    "are mandatory because incomplete declarations are rejected by carrier customs brokers. Returns " +
    "a JSON receipt echoing the submitted declaration.",
  inputSchema: {
    shipper_name: z.string().describe("Full legal name of the shipper / exporter."),
    shipper_company: z.string().describe("Shipper company / organization name."),
    shipper_address_line1: z.string().describe("Shipper street address, line 1."),
    shipper_address_line2: z.string().describe("Shipper street address, line 2 (or empty string)."),
    shipper_city: z.string().describe("Shipper city."),
    shipper_state: z.string().describe("Shipper state / province / region."),
    shipper_postal_code: z.string().describe("Shipper postal / ZIP code."),
    shipper_country: z.string().describe("Shipper country as ISO 3166-1 alpha-2 code."),
    shipper_phone: z.string().describe("Shipper contact phone in E.164 format."),
    shipper_email: z.string().describe("Shipper contact email."),
    recipient_name: z.string().describe("Full legal name of the recipient / importer."),
    recipient_company: z.string().describe("Recipient company name (or empty string)."),
    recipient_address_line1: z.string().describe("Recipient street address, line 1."),
    recipient_address_line2: z.string().describe("Recipient street address, line 2 (or empty string)."),
    recipient_city: z.string().describe("Recipient city."),
    recipient_state: z.string().describe("Recipient state / province / region."),
    recipient_postal_code: z.string().describe("Recipient postal / ZIP code."),
    recipient_country: z.string().describe("Recipient country as ISO 3166-1 alpha-2 code."),
    recipient_phone: z.string().describe("Recipient contact phone in E.164 format."),
    recipient_email: z.string().describe("Recipient contact email."),
    tracking_number: z.string().describe("Carrier tracking / waybill number."),
    carrier_code: z.string().describe("Carrier code, e.g. 'UPS', 'DHL', 'FEDEX'."),
    service_level: z.string().describe("Service level, e.g. 'EXPRESS', 'STANDARD', 'ECONOMY'."),
    package_count: z.number().int().describe("Number of packages in this shipment."),
    total_weight_kg: z.number().describe("Total gross weight in kilograms."),
    length_cm: z.number().describe("Package length in centimeters."),
    width_cm: z.number().describe("Package width in centimeters."),
    height_cm: z.number().describe("Package height in centimeters."),
    contents_description: z.string().describe("Plain-language description of the goods."),
    contents_category: z.string().describe("Category, e.g. 'merchandise', 'gift', 'sample', 'documents', 'return'."),
    hs_tariff_code: z.string().describe("6-10 digit Harmonized System tariff code."),
    country_of_origin: z.string().describe("Country where goods were manufactured (ISO 3166-1 alpha-2)."),
    declared_value: z.number().describe("Declared customs value of the goods."),
    currency: z.string().describe("ISO 4217 currency code for declared value, e.g. 'USD', 'EUR'."),
    incoterm: z.string().describe("Incoterm 2020 code, e.g. 'DDP', 'DAP', 'EXW', 'FOB'."),
    customs_purpose: z.string().describe("Customs purpose code, e.g. 'sale', 'gift', 'sample', 'return', 'repair'."),
    invoice_number: z.string().describe("Commercial invoice number."),
    invoice_date: z.string().describe("Commercial invoice date in YYYY-MM-DD."),
    purchase_order_number: z.string().describe("Buyer purchase order number (or empty string)."),
    exporter_tax_id: z.string().describe("Exporter tax / VAT / EIN identifier."),
    importer_tax_id: z.string().describe("Importer tax / VAT identifier."),
    eori_number: z.string().describe("EU EORI number for the responsible party (or empty string)."),
    license_number: z.string().describe("Export license number (or empty string)."),
    license_type: z.string().describe("Export license type, e.g. 'NLR', 'individual', 'general'."),
    license_issue_date: z.string().describe("License issue date in YYYY-MM-DD (or empty string)."),
    license_expiry_date: z.string().describe("License expiry date in YYYY-MM-DD (or empty string)."),
    signed_by: z.string().describe("Full name of the person signing the declaration."),
    signatory_title: z.string().describe("Job title of the signatory."),
    signatory_email: z.string().describe("Email of the signatory."),
    signature_date: z.string().describe("Date the declaration was signed, YYYY-MM-DD."),
    acknowledged_accuracy: z.boolean().describe("Must be true: signatory acknowledges contents are accurate."),
  },
  handler: async (args) => {
    await slowModeDelay();
    console.log("[submit-customs-declaration]", JSON.stringify(args));
    return textResult(JSON.stringify({ status: "accepted", declaration: args }, null, 2));
  },
};

const createProductListingTool: ToolDef = {
  name: "create-product-listing",
  title: "Create Product Listing",
  description:
    "Creates a marketplace product listing. The first 25 fields are required (core product, pricing, " +
    "inventory, shipping, and listing metadata). The remaining 25 fields are optional and cover " +
    "extended attributes, hazard / handling flags, media, and promotional pricing. Returns a JSON " +
    "receipt of the listing.",
  inputSchema: {
    title: z.string().describe("Product title shown in search results. Max 80 characters."),
    sku: z.string().describe("Seller SKU. Must be unique within the seller account."),
    category: z.string().describe("Marketplace category path, e.g. 'Electronics > Audio > Headphones'."),
    brand: z.string().describe("Brand or manufacturer name."),
    condition: z.string().describe("Item condition: 'new', 'used', 'refurbished', 'open_box'."),
    price: z.number().describe("List price in the specified currency."),
    currency: z.string().describe("ISO 4217 currency code, e.g. 'USD'."),
    quantity_available: z.number().int().describe("Number of units in stock."),
    description: z.string().describe("Long-form product description. Plain text or basic HTML."),
    main_image_url: z.string().describe("Absolute URL of the primary product image."),
    weight_grams: z.number().describe("Shipping weight in grams."),
    length_cm: z.number().describe("Shipping carton length in centimeters."),
    width_cm: z.number().describe("Shipping carton width in centimeters."),
    height_cm: z.number().describe("Shipping carton height in centimeters."),
    shipping_class: z.string().describe("Shipping class code, e.g. 'standard', 'oversize', 'hazmat'."),
    country_of_origin: z.string().describe("Manufacturing country as ISO 3166-1 alpha-2."),
    seller_id: z.string().describe("Marketplace seller account ID."),
    warehouse_id: z.string().describe("Source warehouse / fulfillment center ID."),
    tax_class: z.string().describe("Tax classification, e.g. 'standard', 'reduced', 'zero', 'exempt'."),
    return_policy_id: z.string().describe("Return policy ID configured on the seller account."),
    handling_time_days: z.number().int().describe("Handling time before dispatch, in business days."),
    listing_format: z.string().describe("Listing format: 'fixed_price', 'auction', 'classified'."),
    listing_duration_days: z.number().int().describe("How many days the listing should remain active."),
    start_date: z.string().describe("Listing start date in YYYY-MM-DD."),
    status: z.string().describe("Initial status: 'draft', 'active', 'scheduled'."),
    subtitle: z.string().optional().describe("Optional subtitle shown below the title."),
    gtin: z.string().optional().describe("GTIN / UPC / EAN / ISBN barcode value."),
    mpn: z.string().optional().describe("Manufacturer part number."),
    color: z.string().optional().describe("Primary color."),
    size: z.string().optional().describe("Size designation (e.g. 'M', '42', '15-inch')."),
    material: z.string().optional().describe("Primary material composition."),
    age_group: z.string().optional().describe("Target age group: 'adult', 'kids', 'infant', etc."),
    gender: z.string().optional().describe("Target gender: 'male', 'female', 'unisex'."),
    season: z.string().optional().describe("Target season: 'spring', 'summer', 'fall', 'winter', 'all-season'."),
    style: z.string().optional().describe("Style descriptor, e.g. 'modern', 'vintage'."),
    pattern: z.string().optional().describe("Pattern, e.g. 'solid', 'striped', 'floral'."),
    theme: z.string().optional().describe("Theme tag, e.g. 'holiday', 'sports', 'wedding'."),
    compatible_with: z.string().optional().describe("Compatibility note, e.g. 'iPhone 15 Pro'."),
    warranty_months: z.number().int().optional().describe("Manufacturer warranty length in months."),
    battery_required: z.boolean().optional().describe("Whether the product requires batteries."),
    assembly_required: z.boolean().optional().describe("Whether the product requires assembly."),
    hazmat_class: z.string().optional().describe("UN hazmat class code if applicable."),
    fragile: z.boolean().optional().describe("Mark as fragile for handling."),
    perishable: z.boolean().optional().describe("Whether the product is perishable."),
    cold_chain_required: z.boolean().optional().describe("Whether cold-chain shipping is required."),
    additional_image_urls: z.array(z.string()).optional().describe("Up to 8 additional image URLs."),
    video_url: z.string().optional().describe("Optional product video URL."),
    promotional_price: z.number().optional().describe("Optional sale price."),
    promotional_start_date: z.string().optional().describe("Promotion start date in YYYY-MM-DD."),
    promotional_end_date: z.string().optional().describe("Promotion end date in YYYY-MM-DD."),
  },
  handler: async (args) => {
    await slowModeDelay();
    console.log("[create-product-listing]", JSON.stringify(args));
    const listingId = `lst_${Math.random().toString(36).slice(2, 10)}`;
    return textResult(JSON.stringify({ status: "created", listing_id: listingId, listing: args }, null, 2));
  },
};

const searchPropertiesTool: ToolDef = {
  name: "search-properties",
  title: "Search Real Estate Listings",
  description:
    "Searches real estate listings using up to 50 optional filters covering location, price, " +
    "size, age, amenities, view, accessibility, and pagination. All parameters are optional; with " +
    "no filters the tool returns a default page of recent listings. Returns a JSON object echoing " +
    "the applied filters and a stub result set.",
  inputSchema: {
    location_city: z.string().optional().describe("City name to search within."),
    location_state: z.string().optional().describe("State / province code."),
    location_postal_code: z.string().optional().describe("Postal / ZIP code."),
    location_country: z.string().optional().describe("Country as ISO 3166-1 alpha-2."),
    latitude: z.number().optional().describe("Center latitude for radius search."),
    longitude: z.number().optional().describe("Center longitude for radius search."),
    radius_km: z.number().optional().describe("Radius in kilometers from lat/lon."),
    listing_type: z.string().optional().describe("'sale', 'rent', 'short_term', 'auction'."),
    property_type: z.string().optional().describe("'house', 'apartment', 'condo', 'townhouse', 'land', 'commercial'."),
    min_price: z.number().optional().describe("Minimum price."),
    max_price: z.number().optional().describe("Maximum price."),
    currency: z.string().optional().describe("ISO 4217 currency code for price filters."),
    min_bedrooms: z.number().int().optional().describe("Minimum number of bedrooms."),
    max_bedrooms: z.number().int().optional().describe("Maximum number of bedrooms."),
    min_bathrooms: z.number().optional().describe("Minimum number of bathrooms."),
    max_bathrooms: z.number().optional().describe("Maximum number of bathrooms."),
    min_square_meters: z.number().optional().describe("Minimum interior area in m²."),
    max_square_meters: z.number().optional().describe("Maximum interior area in m²."),
    min_lot_size_m2: z.number().optional().describe("Minimum lot size in m²."),
    max_lot_size_m2: z.number().optional().describe("Maximum lot size in m²."),
    min_year_built: z.number().int().optional().describe("Earliest year built."),
    max_year_built: z.number().int().optional().describe("Latest year built."),
    min_garage_spaces: z.number().int().optional().describe("Minimum number of garage spaces."),
    max_hoa_fee: z.number().optional().describe("Maximum monthly HOA / strata fee."),
    max_property_tax: z.number().optional().describe("Maximum annual property tax."),
    has_pool: z.boolean().optional().describe("Require a pool."),
    has_garden: z.boolean().optional().describe("Require a garden / yard."),
    has_basement: z.boolean().optional().describe("Require a basement."),
    has_elevator: z.boolean().optional().describe("Require an elevator."),
    has_balcony: z.boolean().optional().describe("Require a balcony."),
    has_terrace: z.boolean().optional().describe("Require a terrace."),
    has_fireplace: z.boolean().optional().describe("Require a fireplace."),
    has_air_conditioning: z.boolean().optional().describe("Require air conditioning."),
    has_heating: z.boolean().optional().describe("Require heating."),
    heating_type: z.string().optional().describe("Heating type filter, e.g. 'gas', 'electric', 'heat_pump'."),
    furnished: z.boolean().optional().describe("Require the property to be furnished."),
    pets_allowed: z.boolean().optional().describe("Pets must be allowed."),
    smoking_allowed: z.boolean().optional().describe("Smoking must be allowed."),
    wheelchair_accessible: z.boolean().optional().describe("Require wheelchair accessibility."),
    waterfront: z.boolean().optional().describe("Waterfront properties only."),
    mountain_view: z.boolean().optional().describe("Mountain view required."),
    city_view: z.boolean().optional().describe("City view required."),
    school_district: z.string().optional().describe("School district name."),
    min_school_rating: z.number().optional().describe("Minimum local school rating (0-10)."),
    min_days_on_market: z.number().int().optional().describe("Listings on market at least this many days."),
    max_days_on_market: z.number().int().optional().describe("Listings on market at most this many days."),
    sort_by: z.string().optional().describe("Sort field: 'price', 'date', 'size', 'beds'."),
    sort_order: z.string().optional().describe("'asc' or 'desc'."),
    page: z.number().int().optional().describe("Page number, 1-indexed."),
    limit: z.number().int().optional().describe("Results per page, 1-100."),
  },
  handler: async (args) => {
    await slowModeDelay();
    console.log("[search-properties]", JSON.stringify(args));
    return textResult(JSON.stringify({ status: "ok", filters: args, results: [] }, null, 2));
  },
};

const typeEchoTool: ToolDef = {
  name: "typeEcho",
  title: "Type Echo",
  description:
    "Echoes back the provided typed inputs as a JSON object. Exposes one optional parameter " +
    "per JSON Schema primitive type (integer, number, string, boolean, array, object, null) " +
    "plus a string enum. Useful for verifying that an MCP client correctly serializes and " +
    "round-trips every JSON Schema type.",
  inputSchema: {
    aInteger: z.number().int().optional().describe("Optional integer value to echo."),
    bNumber: z.number().optional().describe("Optional floating-point number to echo."),
    cString: z.string().optional().describe("Optional string value to echo."),
    dBoolean: z.boolean().optional().describe("Optional boolean value to echo."),
    eArray: z.array(z.string()).optional().describe("Optional array of strings to echo."),
    fObject: z.record(z.string(), z.string()).optional().describe("Optional string-to-string map to echo."),
    gNull: z.null().optional().describe("Optional explicit null value to echo."),
    hEnum: z.enum(["alpha", "beta", "gamma"]).optional().describe("Optional enum value: 'alpha', 'beta', or 'gamma'."),
  },
  handler: async (args) => {
    await slowModeDelay();
    return textResult(JSON.stringify(args, null, 2));
  },
};

const staticTools: Record<string, ToolDef> = {
  "get-time": getTime,
  "random-number": randomNumber,
  "reverse": reverse,
  "typeEcho": typeEchoTool,
  "get-contact-by-id": getContactByIdTool,
  "get-contact-by-email": getContactByEmailTool,
  "list-contacts": listContactsTool,
  "search-contacts": searchContactsTool,
  "create-contact": createContactTool,
  "update-contact": updateContactTool,
  "delete-contact": deleteContactTool,
  "submit-customs-declaration": submitCustomsDeclarationTool,
  "create-product-listing": createProductListingTool,
  "search-properties": searchPropertiesTool,
};

export function getToolDef(name: string, version?: ToolVersion): ToolDef | undefined {
  if (name in versionedTools) {
    return versionedTools[name][version || "v1"];
  }
  return staticTools[name];
}

export function getAllToolNames(): string[] {
  return [...Object.keys(versionedTools), ...Object.keys(staticTools)];
}

export function getActiveTools(state: ServerState): ToolDef[] {
  const tools: ToolDef[] = [];
  for (const name of getAllToolNames()) {
    if (!state.enabledTools[name]) continue;
    const version = state.toolVersions[name] as ToolVersion | undefined;
    const def = getToolDef(name, version);
    if (def) tools.push(def);
  }
  return tools;
}

export function hasVersions(name: string): boolean {
  return name in versionedTools;
}

export type { ToolDef };
