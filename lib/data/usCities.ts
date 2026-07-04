// Bundled US-cities list for INSTANT, offline location autocomplete. No network, no geocoder
// per keystroke — every location field filters this array locally so suggestions appear as
// fast as the user can type. Covers all 50 states' largest cities + state capitals + major
// metros / job markets (~330 cities). A field still accepts free-text, so a town not listed
// here can always be typed manually.
//
// Format is exactly "City, ST" so it can be used directly as the field value.

export const US_CITIES: string[] = [
  // — Alabama —
  'Birmingham, AL', 'Montgomery, AL', 'Huntsville, AL', 'Mobile, AL', 'Tuscaloosa, AL',
  // — Alaska —
  'Anchorage, AK', 'Fairbanks, AK', 'Juneau, AK',
  // — Arizona —
  'Phoenix, AZ', 'Tucson, AZ', 'Mesa, AZ', 'Chandler, AZ', 'Scottsdale, AZ', 'Glendale, AZ', 'Gilbert, AZ', 'Tempe, AZ', 'Peoria, AZ',
  // — Arkansas —
  'Little Rock, AR', 'Fayetteville, AR', 'Fort Smith, AR', 'Bentonville, AR',
  // — California —
  'Los Angeles, CA', 'San Diego, CA', 'San Jose, CA', 'San Francisco, CA', 'Fresno, CA', 'Sacramento, CA',
  'Long Beach, CA', 'Oakland, CA', 'Bakersfield, CA', 'Anaheim, CA', 'Santa Ana, CA', 'Riverside, CA',
  'Irvine, CA', 'Chula Vista, CA', 'Fremont, CA', 'San Bernardino, CA', 'Modesto, CA', 'Fontana, CA',
  'Oxnard, CA', 'Santa Clarita, CA', 'Glendale, CA', 'Huntington Beach, CA', 'Santa Rosa, CA', 'Pasadena, CA',
  'Sunnyvale, CA', 'Palo Alto, CA', 'Berkeley, CA', 'Mountain View, CA', 'Torrance, CA', 'Santa Monica, CA',
  // — Colorado —
  'Denver, CO', 'Colorado Springs, CO', 'Aurora, CO', 'Fort Collins, CO', 'Boulder, CO', 'Lakewood, CO', 'Thornton, CO',
  // — Connecticut —
  'Hartford, CT', 'New Haven, CT', 'Stamford, CT', 'Bridgeport, CT', 'Norwalk, CT',
  // — Delaware —
  'Wilmington, DE', 'Dover, DE', 'Newark, DE',
  // — Florida —
  'Jacksonville, FL', 'Miami, FL', 'Tampa, FL', 'Orlando, FL', 'St. Petersburg, FL', 'Hialeah, FL',
  'Tallahassee, FL', 'Fort Lauderdale, FL', 'Port St. Lucie, FL', 'Cape Coral, FL', 'Pembroke Pines, FL',
  'Hollywood, FL', 'Gainesville, FL', 'Coral Springs, FL', 'Clearwater, FL', 'West Palm Beach, FL', 'Naples, FL',
  // — Georgia —
  'Atlanta, GA', 'Augusta, GA', 'Columbus, GA', 'Savannah, GA', 'Athens, GA', 'Sandy Springs, GA', 'Macon, GA', 'Roswell, GA',
  // — Hawaii —
  'Honolulu, HI', 'Hilo, HI', 'Kailua, HI',
  // — Idaho —
  'Boise, ID', 'Meridian, ID', 'Nampa, ID', 'Idaho Falls, ID',
  // — Illinois —
  'Chicago, IL', 'Aurora, IL', 'Naperville, IL', 'Joliet, IL', 'Rockford, IL', 'Springfield, IL', 'Elgin, IL', 'Peoria, IL', 'Champaign, IL',
  // — Indiana —
  'Indianapolis, IN', 'Fort Wayne, IN', 'Evansville, IN', 'South Bend, IN', 'Carmel, IN', 'Bloomington, IN', 'Fishers, IN',
  // — Iowa —
  'Des Moines, IA', 'Cedar Rapids, IA', 'Davenport, IA', 'Iowa City, IA', 'Ames, IA',
  // — Kansas —
  'Wichita, KS', 'Overland Park, KS', 'Kansas City, KS', 'Topeka, KS', 'Olathe, KS', 'Lawrence, KS',
  // — Kentucky —
  'Louisville, KY', 'Lexington, KY', 'Bowling Green, KY', 'Frankfort, KY',
  // — Louisiana —
  'New Orleans, LA', 'Baton Rouge, LA', 'Shreveport, LA', 'Lafayette, LA', 'Lake Charles, LA',
  // — Maine —
  'Portland, ME', 'Bangor, ME', 'Augusta, ME',
  // — Maryland —
  'Baltimore, MD', 'Columbia, MD', 'Germantown, MD', 'Silver Spring, MD', 'Rockville, MD', 'Annapolis, MD', 'Bethesda, MD',
  // — Massachusetts —
  'Boston, MA', 'Worcester, MA', 'Springfield, MA', 'Cambridge, MA', 'Lowell, MA', 'Somerville, MA', 'Quincy, MA', 'Newton, MA',
  // — Michigan —
  'Detroit, MI', 'Grand Rapids, MI', 'Ann Arbor, MI', 'Lansing, MI', 'Flint, MI', 'Dearborn, MI', 'Sterling Heights, MI', 'Warren, MI',
  // — Minnesota —
  'Minneapolis, MN', 'St. Paul, MN', 'Rochester, MN', 'Bloomington, MN', 'Duluth, MN', 'Plymouth, MN',
  // — Mississippi —
  'Jackson, MS', 'Gulfport, MS', 'Southaven, MS', 'Biloxi, MS',
  // — Missouri —
  'Kansas City, MO', 'St. Louis, MO', 'Springfield, MO', 'Columbia, MO', 'Independence, MO', 'Jefferson City, MO',
  // — Montana —
  'Billings, MT', 'Missoula, MT', 'Bozeman, MT', 'Helena, MT',
  // — Nebraska —
  'Omaha, NE', 'Lincoln, NE', 'Bellevue, NE',
  // — Nevada —
  'Las Vegas, NV', 'Henderson, NV', 'Reno, NV', 'North Las Vegas, NV', 'Carson City, NV', 'Sparks, NV',
  // — New Hampshire —
  'Manchester, NH', 'Nashua, NH', 'Concord, NH',
  // — New Jersey —
  'Newark, NJ', 'Jersey City, NJ', 'Paterson, NJ', 'Elizabeth, NJ', 'Trenton, NJ', 'Edison, NJ', 'Princeton, NJ', 'Hoboken, NJ',
  // — New Mexico —
  'Albuquerque, NM', 'Las Cruces, NM', 'Santa Fe, NM', 'Rio Rancho, NM',
  // — New York —
  'New York, NY', 'Buffalo, NY', 'Rochester, NY', 'Yonkers, NY', 'Syracuse, NY', 'Albany, NY',
  'New Rochelle, NY', 'White Plains, NY', 'Brooklyn, NY', 'Queens, NY', 'Bronx, NY', 'Ithaca, NY',
  // — North Carolina —
  'Charlotte, NC', 'Raleigh, NC', 'Greensboro, NC', 'Durham, NC', 'Winston-Salem, NC', 'Fayetteville, NC', 'Cary, NC', 'Wilmington, NC', 'Asheville, NC',
  // — North Dakota —
  'Fargo, ND', 'Bismarck, ND', 'Grand Forks, ND',
  // — Ohio —
  'Columbus, OH', 'Cleveland, OH', 'Cincinnati, OH', 'Toledo, OH', 'Akron, OH', 'Dayton, OH', 'Canton, OH',
  // — Oklahoma —
  'Oklahoma City, OK', 'Tulsa, OK', 'Norman, OK', 'Broken Arrow, OK', 'Edmond, OK',
  // — Oregon —
  'Portland, OR', 'Salem, OR', 'Eugene, OR', 'Gresham, OR', 'Hillsboro, OR', 'Bend, OR', 'Beaverton, OR',
  // — Pennsylvania —
  'Philadelphia, PA', 'Pittsburgh, PA', 'Allentown, PA', 'Erie, PA', 'Harrisburg, PA', 'Scranton, PA', 'Bethlehem, PA', 'Lancaster, PA',
  // — Rhode Island —
  'Providence, RI', 'Warwick, RI', 'Cranston, RI',
  // — South Carolina —
  'Columbia, SC', 'Charleston, SC', 'Greenville, SC', 'Mount Pleasant, SC', 'Rock Hill, SC', 'Myrtle Beach, SC',
  // — South Dakota —
  'Sioux Falls, SD', 'Rapid City, SD', 'Pierre, SD',
  // — Tennessee —
  'Nashville, TN', 'Memphis, TN', 'Knoxville, TN', 'Chattanooga, TN', 'Clarksville, TN', 'Franklin, TN', 'Murfreesboro, TN',
  // — Texas —
  'Houston, TX', 'San Antonio, TX', 'Dallas, TX', 'Austin, TX', 'Fort Worth, TX', 'El Paso, TX', 'Arlington, TX',
  'Corpus Christi, TX', 'Plano, TX', 'Laredo, TX', 'Lubbock, TX', 'Irving, TX', 'Garland, TX', 'Frisco, TX',
  'McKinney, TX', 'Amarillo, TX', 'Grand Prairie, TX', 'Brownsville, TX', 'Killeen, TX', 'Denton, TX', 'Round Rock, TX', 'The Woodlands, TX',
  // — Utah —
  'Salt Lake City, UT', 'West Valley City, UT', 'Provo, UT', 'Orem, UT', 'Sandy, UT', 'Ogden, UT', 'Lehi, UT', 'St. George, UT',
  // — Vermont —
  'Burlington, VT', 'Montpelier, VT',
  // — Virginia —
  'Virginia Beach, VA', 'Norfolk, VA', 'Richmond, VA', 'Arlington, VA', 'Chesapeake, VA', 'Alexandria, VA', 'Newport News, VA', 'Charlottesville, VA', 'Reston, VA',
  // — Washington —
  'Seattle, WA', 'Spokane, WA', 'Tacoma, WA', 'Bellevue, WA', 'Vancouver, WA', 'Kent, WA', 'Everett, WA', 'Redmond, WA', 'Renton, WA', 'Olympia, WA',
  // — Washington DC —
  'Washington, DC',
  // — West Virginia —
  'Charleston, WV', 'Huntington, WV', 'Morgantown, WV',
  // — Wisconsin —
  'Milwaukee, WI', 'Madison, WI', 'Green Bay, WI', 'Kenosha, WI', 'Racine, WI', 'Appleton, WI',
  // — Wyoming —
  'Cheyenne, WY', 'Casper, WY', 'Jackson, WY',
  // — Remote —
  'Remote',
];

// Instant, ranked local autocomplete over US_CITIES. Prefix matches (on the city name or the
// full "City, ST") rank above mid-string matches. Pure + synchronous — no network.
export function matchCities(query: string, limit = 6): string[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const starts: string[] = [];
  const contains: string[] = [];
  for (const city of US_CITIES) {
    const lc = city.toLowerCase();
    if (lc.startsWith(q)) starts.push(city);
    else if (lc.includes(q)) contains.push(city);
    if (starts.length >= limit) break;
  }
  return [...starts, ...contains].slice(0, limit);
}
