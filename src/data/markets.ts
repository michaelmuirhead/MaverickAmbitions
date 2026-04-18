/**
 * Neighborhoods / markets available at new-game start.
 *
 * **Setting (v0.7.3):** All 46 markets below are neighborhoods of
 * **Maverick County, NY** — a fictional booming county on the outskirts
 * of New York City, and the game's Phase 1 sandbox region. Descriptions
 * are written to evoke real NY-metro texture: a mini-Manhattan downtown,
 * Long Island-adjacent coastal villages, Westchester/Nassau-flavored
 * suburbs, Catskills-adjacent upstate hamlets, and a NY Harbor-style
 * industrial / port belt. See `src/data/regions.ts` for the region
 * container; later phases (NYC proper, Long Island, NJ; then national
 * metros) will add more Regions alongside Maverick County.
 *
 * v0.7.1 expanded the roster from the original 4 core-city neighborhoods
 * to a 22-market metro. v0.7.2 widened it again to 46 markets across
 * seven archetype bands. v0.7.3 adds flavor descriptions + the Region
 * membership without touching the roster itself.
 *
 * Archetypes vary on three axes:
 *
 *   • **population** — drives foot-traffic potential. Ranges from ~4K (small
 *     agricultural rural town) to ~85K (dense residential core).
 *   • **medianIncome** — drives willingness-to-pay. From ~$28K (deeply
 *     working-class) to ~$145K (elite enclave).
 *   • **desirability** — 0..1 multiplier applied to rent, wages, and
 *     property value. Roughly "how much does the market charge operators."
 *     Low desirability = cheap to enter but harder to command premium
 *     pricing; high desirability = prime rent but premium customers.
 *
 * The four original IDs (`m_downtown`, `m_riverside`, `m_oak_hills`,
 * `m_southside`) are preserved so v0.1–v0.7 saves hydrate cleanly, as are
 * the v0.7.1 additions. New v0.7.2 markets are merged into old saves via
 * the v4 → v5 migration in `src/engine/save/schema.ts`. v0.7.3 adds a
 * v5 → v6 migration that back-fills `regionId` on older market records.
 */

import type { Market } from "@/types/game";

import { dollars } from "@/lib/money";

import { MARKET_DEMOGRAPHICS } from "./marketDemographics";
import { LAUNCH_REGION_ID } from "./regions";

/**
 * Hand-authored market roster. See `marketDemographics.ts` for the
 * demographic overlay that is merged onto each market at module load time
 * (the export below, `STARTER_MARKETS`, is the merged result).
 */
const STARTER_MARKETS_BASE: Record<string, Market> = {
  // ---------- Central city (original v0.1 markets) ----------

  m_downtown: {
    id: "m_downtown",
    name: "Downtown",
    population: 42_000,
    medianIncome: dollars(72_000),
    desirability: 0.85,
    description:
      "The county seat's commercial spine — a glass-and-brownstone district modeled on lower Manhattan, with subway connections into the city proper and Sunday foot traffic that rivals any weekday.",
    regionId: LAUNCH_REGION_ID,
    businessIds: [],
  },
  m_riverside: {
    id: "m_riverside",
    name: "Riverside",
    population: 28_000,
    medianIncome: dollars(58_000),
    desirability: 0.6,
    description:
      "A tidal-strait neighborhood where 19th-century row houses meet converted warehouse lofts, a weekend kayak launch, and a waterfront boardwalk that fills up the first warm Saturday in April.",
    regionId: LAUNCH_REGION_ID,
    businessIds: [],
  },
  m_oak_hills: {
    id: "m_oak_hills",
    name: "Oak Hills",
    population: 35_000,
    medianIncome: dollars(96_000),
    desirability: 0.92,
    description:
      "An old-money residential pocket of slate-roofed Tudors and Colonials — the kind of zip code Westchester realtors quote in full, and the kind of commercial strip where a cafe owner waits eight months for a liquor license.",
    regionId: LAUNCH_REGION_ID,
    businessIds: [],
  },
  m_southside: {
    id: "m_southside",
    name: "Southside",
    population: 52_000,
    medianIncome: dollars(42_000),
    desirability: 0.45,
    description:
      "A dense, working-class district south of the tracks — bodegas, halal carts, two-fare zones, and auto-body shops holding out against another round of rezoning proposals.",
    regionId: LAUNCH_REGION_ID,
    businessIds: [],
  },

  // ---------- Greater metro urban ----------

  m_midtown: {
    // Dense residential mid-rise corridor — highest population in the
    // metro, solidly middle-class. The "safe" early play.
    id: "m_midtown",
    name: "Midtown",
    population: 68_000,
    medianIncome: dollars(64_000),
    desirability: 0.78,
    description:
      "Mid-rise prewar apartment canyons where most of the county actually lives. Bodega on every corner, stroller on every block, a D-train rumble every four minutes.",
    regionId: LAUNCH_REGION_ID,
    businessIds: [],
  },
  m_warehouse_district: {
    // Gentrifying former-industrial strip. Lower desirability today means
    // cheap rent; population is thin but trending up.
    id: "m_warehouse_district",
    name: "Warehouse District",
    population: 17_000,
    medianIncome: dollars(54_000),
    desirability: 0.55,
    description:
      "Brick loft buildings that used to make typewriter parts now house ad agencies and $14-cocktail bars. A few holdout dry cleaners and machine shops are still counting the days.",
    regionId: LAUNCH_REGION_ID,
    businessIds: [],
  },
  m_university_heights: {
    // Student-dominated district. Low income, but foot traffic is dense
    // and price-elastic customers drive volume plays.
    id: "m_university_heights",
    name: "University Heights",
    population: 22_000,
    medianIncome: dollars(32_000),
    desirability: 0.7,
    description:
      "Wraps the state university campus. Pizza slices, textbook exchanges, and five-roommate walk-ups that empty out every June and flood back every September.",
    regionId: LAUNCH_REGION_ID,
    businessIds: [],
  },
  m_harborview: {
    // Waterfront tourist strip. Premium rent, seasonal demand skew.
    id: "m_harborview",
    name: "Harborview",
    population: 26_000,
    medianIncome: dollars(82_000),
    desirability: 0.88,
    description:
      "A waterfront promenade of boutique hotels and oyster bars with a skyline view of Manhattan across the water. Packed the first warm weekend in April through Columbus Day, empty every February.",
    regionId: LAUNCH_REGION_ID,
    businessIds: [],
  },
  m_silverlake: {
    // Tech-professional neighborhood. Highest urban income, discerning.
    id: "m_silverlake",
    name: "Silverlake",
    population: 31_000,
    medianIncome: dollars(118_000),
    desirability: 0.9,
    description:
      "A leafier inner neighborhood gentrified by the tech set — lap pools behind renovated brownstones, $8 toast, and a farmer's market every Sunday where the kale costs more than the wine.",
    regionId: LAUNCH_REGION_ID,
    businessIds: [],
  },
  m_old_town: {
    // Historic district. Small population, charm premium, strict rules.
    id: "m_old_town",
    name: "Old Town",
    population: 15_000,
    medianIncome: dollars(68_000),
    desirability: 0.75,
    description:
      "The county's colonial core — cobblestones, gas-lamp replicas, and a historical preservation society that has fought every storefront rezoning proposal since 1974.",
    regionId: LAUNCH_REGION_ID,
    businessIds: [],
  },
  m_arts_district: {
    // Creative-class gentrifier. Income modest today, trajectory bullish.
    id: "m_arts_district",
    name: "Arts District",
    population: 14_000,
    medianIncome: dollars(51_000),
    desirability: 0.66,
    description:
      "An ex-industrial corridor turned gallery row. Murals everywhere, warehouse parties until 4 a.m., and landlords eyeing the next round of rent hikes with quiet glee.",
    regionId: LAUNCH_REGION_ID,
    businessIds: [],
  },
  m_little_portugal: {
    // Dense ethnic enclave with strong walk-up foot traffic. Modest
    // income but very loyal customers — long-tenured operators thrive.
    id: "m_little_portugal",
    name: "Little Portugal",
    population: 24_000,
    medianIncome: dollars(47_000),
    desirability: 0.62,
    description:
      "A tight-knit Lusophone enclave of tiled storefronts, grilled-sardine cafes, and soccer bars. Neighbors know each other by first name; strangers get sized up at the door.",
    regionId: LAUNCH_REGION_ID,
    businessIds: [],
  },
  m_chinatown: {
    // Dense, highly-walkable ethnic district. Older demographic lean,
    // cash-heavy customers, relentless lunch rush. Loyalty compounds.
    id: "m_chinatown",
    name: "Chinatown",
    population: 31_000,
    medianIncome: dollars(41_000),
    desirability: 0.68,
    description:
      "A dense east-side district of dim-sum halls, herbalists, and fish markets under awnings stacked three deep. The cash economy runs deep, and customer loyalty runs deeper.",
    regionId: LAUNCH_REGION_ID,
    businessIds: [],
  },
  m_garment_district: {
    // Wholesale / fashion commercial spine. Low residents, daytime
    // foot traffic from buyers and showroom workers.
    id: "m_garment_district",
    name: "Garment District",
    population: 13_000,
    medianIncome: dollars(55_000),
    desirability: 0.64,
    description:
      "A wholesale strip lined with showroom buildings and loading bays. Almost no residents — but the lunch-hour buyer traffic rivals Midtown's, and everybody knows the good coffee cart.",
    regionId: LAUNCH_REGION_ID,
    businessIds: [],
  },
  m_theater_district: {
    // Entertainment / nightlife core. Evening-and-weekend demand skew
    // and a big captive dinner-before-the-show crowd.
    id: "m_theater_district",
    name: "Theater District",
    population: 16_000,
    medianIncome: dollars(72_000),
    desirability: 0.82,
    description:
      "A neon-lit stretch of restored movie palaces, off-Broadway-style theaters, and pre-show dinner spots that do a year's rent in November and December alone.",
    regionId: LAUNCH_REGION_ID,
    businessIds: [],
  },
  m_financial_district: {
    // High-rise office core. Tiny residential population, explosive
    // weekday lunch/coffee traffic, dead on weekends.
    id: "m_financial_district",
    name: "Financial District",
    population: 9_000,
    medianIncome: dollars(125_000),
    desirability: 0.88,
    description:
      "A cluster of glass towers and hedge-fund satellite offices spun out from lower Manhattan. Weekday traffic is ferocious, weekends are a ghost town, and the suits tip well.",
    regionId: LAUNCH_REGION_ID,
    businessIds: [],
  },

  // ---------- Suburbs ----------

  m_cedar_park: {
    // Middle-class family suburb. The bread-and-butter chain market.
    id: "m_cedar_park",
    name: "Cedar Park",
    population: 38_000,
    medianIncome: dollars(74_000),
    desirability: 0.7,
    description:
      "A classic Levittown-era family suburb — split-levels, one-car garages, Little League on Saturdays, and a commuter lot full of hatchbacks by 7:10 a.m.",
    regionId: LAUNCH_REGION_ID,
    businessIds: [],
  },
  m_willow_creek: {
    // Newer master-planned suburb. Higher income, good schools, parking.
    id: "m_willow_creek",
    name: "Willow Creek",
    population: 45_000,
    medianIncome: dollars(88_000),
    desirability: 0.76,
    description:
      "A newer master-planned development off the parkway — cul-de-sacs, HOA-approved siding, top-rated public schools, and a very particular opinion on street-parking enforcement.",
    regionId: LAUNCH_REGION_ID,
    businessIds: [],
  },
  m_pine_ridge: {
    // Gated enclave. Tiny population, enormous wallets, hostile to new
    // entrants — every sqft of retail is already spoken for.
    id: "m_pine_ridge",
    name: "Pine Ridge",
    population: 11_500,
    medianIncome: dollars(145_000),
    desirability: 0.95,
    description:
      "A gated enclave of gated enclaves. Long driveways, private police, and a country club with a seventeen-year waitlist. Commercial tenants audition here — they don't just sign leases.",
    regionId: LAUNCH_REGION_ID,
    businessIds: [],
  },
  m_elmwood: {
    // Aging inner-ring suburb. Declining demographics, cheap rent, real
    // "turnaround play" risk/reward.
    id: "m_elmwood",
    name: "Elmwood",
    population: 29_000,
    medianIncome: dollars(48_000),
    desirability: 0.5,
    description:
      "A graying inner-ring suburb whose split-levels haven't been updated since the original owners moved in. Cheap rent, thin foot traffic, and the textbook turnaround-flip opportunity.",
    regionId: LAUNCH_REGION_ID,
    businessIds: [],
  },
  m_briar_glen: {
    // Upper-middle suburb, newer than Elmwood, more expensive than Cedar.
    id: "m_briar_glen",
    name: "Briar Glen",
    population: 24_000,
    medianIncome: dollars(103_000),
    desirability: 0.83,
    description:
      "An upper-middle parkway suburb favored by young finance and law families — French Provincials, tennis clubs, weekend tee times, and a kid-to-au-pair ratio worth Googling.",
    regionId: LAUNCH_REGION_ID,
    businessIds: [],
  },
  m_maple_grove: {
    // Generic big middle-class suburb. The volume play — high
    // population, nothing special, reliable cashflow.
    id: "m_maple_grove",
    name: "Maple Grove",
    population: 41_000,
    medianIncome: dollars(69_000),
    desirability: 0.68,
    description:
      "A reliable middle-class bedroom community. Chain restaurants on the main drag, a Costco at the edge of town, and a commuter station with 6:42 a.m. express service into Grand Central.",
    regionId: LAUNCH_REGION_ID,
    businessIds: [],
  },
  m_hillcrest: {
    // Hillside upper-middle neighborhood. Older homes, established
    // trees, school-district premium.
    id: "m_hillcrest",
    name: "Hillcrest",
    population: 27_000,
    medianIncome: dollars(94_000),
    desirability: 0.8,
    description:
      "Hilly lanes of established homes under old maples. Think Bronxville with cheaper taxes — for now — and a PTA that treats SAT prep as municipal infrastructure.",
    regionId: LAUNCH_REGION_ID,
    businessIds: [],
  },
  m_fairview_heights: {
    // Older lower-middle ring suburb. Modest incomes, cheap rent,
    // strip-mall retail that hasn't been refreshed since the 90s.
    id: "m_fairview_heights",
    name: "Fairview Heights",
    population: 33_000,
    medianIncome: dollars(52_000),
    desirability: 0.55,
    description:
      "An older lower-middle-class ring suburb. Strip malls with visible vacancies, pizzerias that haven't changed the menu in thirty years, and quietly eroding school ratings.",
    regionId: LAUNCH_REGION_ID,
    businessIds: [],
  },
  m_tanglewood: {
    // Wealthy wooded suburb. Understated old-money, large lots, the
    // "you haven't heard of it unless you live near it" market.
    id: "m_tanglewood",
    name: "Tanglewood",
    population: 15_000,
    medianIncome: dollars(128_000),
    desirability: 0.9,
    description:
      "A wooded, old-money enclave set behind stone walls. Riding trails, carriage houses, and a HOA that has repeatedly gone on record against Starbucks on aesthetic grounds.",
    regionId: LAUNCH_REGION_ID,
    businessIds: [],
  },
  m_summit_ridge: {
    // New-money luxury development. Showier than Tanglewood, younger
    // families, aggressive spending.
    id: "m_summit_ridge",
    name: "Summit Ridge",
    population: 18_000,
    medianIncome: dollars(135_000),
    desirability: 0.93,
    description:
      "New-money luxury — McMansions with three-car garages and catering kitchens, populated by hedge-fund families priced out of Scarsdale. Every second car is a G-Wagon.",
    regionId: LAUNCH_REGION_ID,
    businessIds: [],
  },

  // ---------- Outlying / rural ----------

  m_meadowbrook: {
    // Exurban rural-residential. Sparse population, spread-out customers,
    // low rent. Plays well as a lifestyle / low-ambition empire piece.
    id: "m_meadowbrook",
    name: "Meadowbrook",
    population: 8_200,
    medianIncome: dollars(56_000),
    desirability: 0.4,
    description:
      "A horse-country exurb on the county's northern edge. Fifteen-acre lots, a farmers market on Saturdays, and a diner that still takes exact change and keeps the pies behind glass.",
    regionId: LAUNCH_REGION_ID,
    businessIds: [],
  },
  m_fort_hayward: {
    // Military-adjacent town. Steady (if modest) incomes, PCS-driven
    // customer turnover every 2–3 years.
    id: "m_fort_hayward",
    name: "Fort Hayward",
    population: 19_000,
    medianIncome: dollars(46_000),
    desirability: 0.5,
    description:
      "A small town built around an old army reservation in the county's north. Steady paychecks from the base, PCS cycles that turn over the customer base every two or three years.",
    regionId: LAUNCH_REGION_ID,
    businessIds: [],
  },
  m_junction_town: {
    // Small highway-exit town. Pass-through foot traffic from the
    // interstate beats the tiny resident population most weeks.
    id: "m_junction_town",
    name: "Junction Town",
    population: 6_400,
    medianIncome: dollars(39_000),
    desirability: 0.35,
    description:
      "A crossroads village where two old state routes meet the interstate. Truck stops, a twenty-four-hour diner, and far more pass-through traffic than residents.",
    regionId: LAUNCH_REGION_ID,
    businessIds: [],
  },
  m_cypress_falls: {
    // Lake/waterfall destination town. Summer tourism doubles the
    // effective population; dead five months of the year.
    id: "m_cypress_falls",
    name: "Cypress Falls",
    population: 7_500,
    medianIncome: dollars(62_000),
    desirability: 0.65,
    description:
      "A Catskills-style weekend town with a waterfall, a general store, and a summer season that has to carry the other nine months of the year.",
    regionId: LAUNCH_REGION_ID,
    businessIds: [],
  },
  m_stonebrook: {
    // Horse-country estate belt. Tiny population, enormous per-capita
    // wealth, zoning that fights anything resembling retail.
    id: "m_stonebrook",
    name: "Stonebrook",
    population: 5_800,
    medianIncome: dollars(98_000),
    desirability: 0.7,
    description:
      "Horse farms and rolling estates, equidistant from the Hunt Club and the Manhattan commuter rail. The realtors call it 'Hudson Valley country' and charge accordingly.",
    regionId: LAUNCH_REGION_ID,
    businessIds: [],
  },
  m_copper_valley: {
    // Former mining town in structural decline. Dirt-cheap real estate,
    // eroding demographics, niche turnaround opportunity.
    id: "m_copper_valley",
    name: "Copper Valley",
    population: 9_200,
    medianIncome: dollars(34_000),
    desirability: 0.3,
    description:
      "A former iron-mining village tucked in the county's northern hills. The mines closed in 1974; the scenery stayed, the property taxes stayed, the jobs didn't.",
    regionId: LAUNCH_REGION_ID,
    businessIds: [],
  },
  m_willow_bend: {
    // Agricultural rural town. Tiny, working-class, seasonal income
    // cycles tied to harvest. The smallest market on the map.
    id: "m_willow_bend",
    name: "Willow Bend",
    population: 4_200,
    medianIncome: dollars(44_000),
    desirability: 0.35,
    description:
      "A sparse agricultural hamlet on the far northern edge of the county. Dairy farms, a single elementary school, and deer on every back road by dusk.",
    regionId: LAUNCH_REGION_ID,
    businessIds: [],
  },
  m_pineview: {
    // Retirement-community town. Older demographic, fixed incomes,
    // early-dinner hours, highly price-sensitive.
    id: "m_pineview",
    name: "Pineview",
    population: 12_000,
    medianIncome: dollars(58_000),
    desirability: 0.6,
    description:
      "A retirement community built around an 18-hole golf course. Early-bird specials, tightly organized HOAs, and the quietest streets in the county after 9 p.m.",
    regionId: LAUNCH_REGION_ID,
    businessIds: [],
  },

  // ---------- Specialty commercial districts ----------

  m_tech_park: {
    // Corporate-campus office park. Low residential population but
    // weekday foot traffic from the firms. High desirability because of
    // income profile of on-site workers.
    id: "m_tech_park",
    name: "Tech Park",
    population: 9_100,
    medianIncome: dollars(132_000),
    desirability: 0.82,
    description:
      "A low-slung corporate campus cluster off the parkway — the county's answer to a Route 128 or Cherry Hill office park, with catered lunches and private shuttles to Grand Central.",
    regionId: LAUNCH_REGION_ID,
    businessIds: [],
  },
  m_medical_district: {
    // Hospital + med-office cluster. Shift-worker lunch crowd; high
    // per-capita income; strict zoning.
    id: "m_medical_district",
    name: "Medical District",
    population: 11_800,
    medianIncome: dollars(94_000),
    desirability: 0.8,
    description:
      "A teaching hospital anchored by med-office towers and an outpatient wing. Shift changes at seven and seven — and the surgeons' cafeteria never closes.",
    regionId: LAUNCH_REGION_ID,
    businessIds: [],
  },
  m_airport_commons: {
    // Airport-adjacent commercial strip. Transient customer base,
    // 24/7 demand curve, hotels and rental-car lots dominate.
    id: "m_airport_commons",
    name: "Airport Commons",
    population: 6_500,
    medianIncome: dollars(58_000),
    desirability: 0.6,
    description:
      "The commercial strip ringing the county's regional airport. Hotel row, long-term parking lots, and a 24-hour diner that serves a 3 a.m. breakfast to every flight crew in the county.",
    regionId: LAUNCH_REGION_ID,
    businessIds: [],
  },
  m_convention_plaza: {
    // Convention-center district. Extreme event-driven demand spikes,
    // otherwise quiet. Rewards operators who staff elastically.
    id: "m_convention_plaza",
    name: "Convention Plaza",
    population: 4_800,
    medianIncome: dollars(71_000),
    desirability: 0.72,
    description:
      "A purpose-built event district around the county convention center. Deserted most weeks, mobbed during trade shows, and ruled by a hotel-room-block calendar nobody who isn't a local owner knows how to read.",
    regionId: LAUNCH_REGION_ID,
    businessIds: [],
  },
  m_campus_commons: {
    // University-adjacent commercial strip. Bookstores, bars, cheap
    // eats; empties in summer and over winter break.
    id: "m_campus_commons",
    name: "Campus Commons",
    population: 14_000,
    medianIncome: dollars(38_000),
    desirability: 0.67,
    description:
      "The commercial strip serving the state university — bars, textbook stores, cheap Thai, and a five-month seasonal slump every summer when the dorms go dark.",
    regionId: LAUNCH_REGION_ID,
    businessIds: [],
  },

  // ---------- Coastal / resort ----------

  m_seacliff: {
    // High-end coastal enclave on the bluffs. View premium, restrictive
    // coastal-commission zoning, ultra-loyal seasonal-resident clientele.
    id: "m_seacliff",
    name: "Seacliff",
    population: 9_000,
    medianIncome: dollars(118_000),
    desirability: 0.88,
    description:
      "High bluffs over the Sound, million-dollar sea-view homes, and a North Shore-style village center with exactly one traffic light and four competing realtors.",
    regionId: LAUNCH_REGION_ID,
    businessIds: [],
  },
  m_marlin_harbor: {
    // Working fishing village slowly tipping toward tourism. Mixed
    // blue-collar and weekender customer base, heavy summer skew.
    id: "m_marlin_harbor",
    name: "Marlin Harbor",
    population: 11_500,
    medianIncome: dollars(58_000),
    desirability: 0.65,
    description:
      "A working South Shore fishing village where the lobster boats still go out at 4 a.m. — and where Brooklyn weekenders have quietly started buying up the second-row cottages.",
    regionId: LAUNCH_REGION_ID,
    businessIds: [],
  },
  m_sandy_point: {
    // Mass-market beach town. Big summer surge, boardwalk retail, low
    // off-season baseline. Price-elastic tourist customers.
    id: "m_sandy_point",
    name: "Sandy Point",
    population: 16_000,
    medianIncome: dollars(63_000),
    desirability: 0.72,
    description:
      "A mass-market Long Island-adjacent beach town: boardwalk pizza, miniature golf, T-shirt shops, and a Memorial-to-Labor-Day business cycle.",
    regionId: LAUNCH_REGION_ID,
    businessIds: [],
  },
  m_bayshore_marina: {
    // Marina / yacht-club community. The richest market on the map by
    // some measures; desirability tied to slip-fee competition.
    id: "m_bayshore_marina",
    name: "Bayshore Marina",
    population: 7_200,
    medianIncome: dollars(142_000),
    desirability: 0.93,
    description:
      "Private slips, yacht-club flags, and captain's-license window decals — the kind of Sound-front community that mentions its zip code in press releases and closes the gates at sundown.",
    regionId: LAUNCH_REGION_ID,
    businessIds: [],
  },

  // ---------- Industrial / port ----------

  m_rust_belt: {
    // Declining heavy-industrial district. Big population of shift
    // workers, thin wages, cheap rent, brutally price-sensitive.
    id: "m_rust_belt",
    name: "Rust Belt",
    population: 21_000,
    medianIncome: dollars(37_000),
    desirability: 0.32,
    description:
      "A belt of shuttered factories and half-occupied mill buildings inland from the port. Cheap rent, skeptical landlords, and a tenacious working-class population that refuses to move.",
    regionId: LAUNCH_REGION_ID,
    businessIds: [],
  },
  m_harbor_works: {
    // Active container port + warehouses. Steady blue-collar demand
    // but heavy truck traffic and zoning hostile to retail.
    id: "m_harbor_works",
    name: "Harbor Works",
    population: 13_000,
    medianIncome: dollars(48_000),
    desirability: 0.48,
    description:
      "The county's active container terminal — gantry cranes, stacks of TEUs, and a twenty-four-hour diner for truckers that pre-dates the interstate and the local zoning code.",
    regionId: LAUNCH_REGION_ID,
    businessIds: [],
  },
  m_rail_yard: {
    // Freight/logistics hub. Sparse housing, 24/7 shift workers, odd
    // hours favor diners and gas-station convenience plays.
    id: "m_rail_yard",
    name: "Rail Yard",
    population: 8_500,
    medianIncome: dollars(43_000),
    desirability: 0.4,
    description:
      "A CSX-era freight yard where locomotives idle next to a Dunkin' and a tire shop. Cheap land, awful zoning, steady blue-collar traffic on odd hours.",
    regionId: LAUNCH_REGION_ID,
    businessIds: [],
  },
};

/**
 * Final exported roster — `STARTER_MARKETS_BASE` merged with the
 * demographic overlay from `marketDemographics.ts`. Callers read
 * `market.demographics` directly; no additional lookup is needed.
 */
export const STARTER_MARKETS: Record<string, Market> = Object.fromEntries(
  Object.entries(STARTER_MARKETS_BASE).map(([id, market]) => [
    id,
    { ...market, demographics: MARKET_DEMOGRAPHICS[id] },
  ]),
);
