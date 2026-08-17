// Category definitions shown to teachers, and the mapping from each
// model's raw labels onto them. Model labels not listed here are ignored
// on purpose (currency, job titles, eye color, etc. — noise in essays).

export const TYPES = {
  NAME:     { ph: 'NAME',     title: 'Names' },
  ORG:      { ph: 'ORG',      title: 'Schools & organizations' },
  EMAIL:    { ph: 'EMAIL',    title: 'Emails' },
  PHONE:    { ph: 'PHONE',    title: 'Phone numbers' },
  ADDRESS:  { ph: 'ADDRESS',  title: 'Street addresses' },
  CITY:     { ph: 'CITY',     title: 'Cities' },
  STATE:    { ph: 'STATE',    title: 'States & counties' },
  ZIP:      { ph: 'ZIP',      title: 'Zip codes' },
  DOB:      { ph: 'BIRTHDATE',title: 'Birth dates' },
  DATE:     { ph: 'DATE',     title: 'Other dates' },
  AGE:      { ph: 'AGE',      title: 'Ages' },
  SSN:      { ph: 'SSN',      title: 'Social Security numbers' },
  ID:       { ph: 'ID',       title: 'ID & account numbers' },
  USERNAME: { ph: 'USERNAME', title: 'Usernames' },
  PASSWORD: { ph: 'PASSWORD', title: 'Passwords' },
  LINK:     { ph: 'LINK',     title: 'Links & online addresses' },
  // neighbor-test categories — GRADE and HEALTH start flagged, not scrubbed
  ROOM:     { ph: 'ROOM',     title: 'Bus & room numbers' },
  GRADE:    { ph: 'GRADE',    title: 'Grade levels (you decide)' },
  HEALTH:   { ph: 'HEALTH',   title: 'Health & diagnoses (you decide)' },
  // deep-check categories (IEP deep check) — all flagged, never auto-scrubbed
  FAMILY:   { ph: 'FAMILY',   title: 'Family & relationships (you decide)' },
  CHURCH:   { ph: 'CHURCH',   title: 'Churches & religious groups (you decide)' },
  WORK:     { ph: 'WORKPLACE',title: 'Businesses & employers (you decide)' },
  ACTIVITY: { ph: 'ACTIVITY', title: 'Teams, clubs & activities (you decide)' },
  BENEFIT:  { ph: 'BENEFIT',  title: 'Benefits & services (you decide)' },
};

export const LABEL_TO_TYPE = {
  // people
  FIRSTNAME: 'NAME', MIDDLENAME: 'NAME', LASTNAME: 'NAME',
  GIVENNAME: 'NAME', SURNAME: 'NAME', PREFIX: 'NAME', TITLE: 'NAME',
  // orgs
  COMPANYNAME: 'ORG',
  // contact
  EMAIL: 'EMAIL',
  PHONENUMBER: 'PHONE', TELEPHONENUM: 'PHONE',
  // location
  STREET: 'ADDRESS', STREETADDRESS: 'ADDRESS', BUILDINGNUMBER: 'ADDRESS',
  BUILDINGNUM: 'ADDRESS', SECONDARYADDRESS: 'ADDRESS',
  CITY: 'CITY', STATE: 'STATE', COUNTY: 'STATE', ZIPCODE: 'ZIP',
  // dates & age
  DOB: 'DOB', DATEOFBIRTH: 'DOB', DATE: 'DATE', AGE: 'AGE',
  // government / financial identifiers
  SSN: 'SSN', SOCIALNUM: 'SSN',
  DRIVERLICENSENUM: 'ID', IDCARDNUM: 'ID', TAXNUM: 'ID', PASSPORTNUM: 'ID',
  ACCOUNTNUMBER: 'ID', ACCOUNTNUM: 'ID', CREDITCARDNUMBER: 'ID',
  CREDITCARDCVV: 'ID', IBAN: 'ID', BIC: 'ID', PIN: 'ID',
  MASKEDNUMBER: 'ID', VEHICLEVIN: 'ID', VEHICLEVRM: 'ID', PHONEIMEI: 'ID',
  // online identity
  USERNAME: 'USERNAME', ACCOUNTNAME: 'USERNAME', PASSWORD: 'PASSWORD',
  URL: 'LINK', IP: 'LINK', IPV4: 'LINK', IPV6: 'LINK', MAC: 'LINK',
  USERAGENT: 'LINK', BITCOINADDRESS: 'LINK', ETHEREUMADDRESS: 'LINK',
  LITECOINADDRESS: 'LINK',
};
