// Seed data for the FMD backend -- the "behind the scenes" records, the same
// values the frontend used to load from public/data.json.
//
// `lists`  -> each becomes a real relational TABLE in Postgres (SQL). Column
//             types are inferred from the values (integers stay numbers).
// `stores` -> each becomes a JSONB document COLLECTION in Postgres (NoSQL).
//
// The split mirrors the [List]/[Store] declarations in app.fmd: a [List] is
// relational, a [Store] is schemaless JSON. Nothing here says "sql"/"nosql";
// the *kind of container* is the routing signal.

export const lists = {
  schedule: {
    columns: ['Time', 'Activity'],
    rows: [
      { Time: '09:00', Activity: 'Venue setup & decor' },
      { Time: '12:30', Activity: 'Catering arrives' },
      { Time: '15:00', Activity: 'Ceremony' },
      { Time: '18:00', Activity: 'Reception & dinner' },
    ],
  },
  vendors: {
    // Status is boolean (boolStatus): true = confirmed, false = pending.
    columns: ['Name', 'Status'],
    rows: [
      { Name: 'EventCo Rentals', Status: true },
      { Name: 'Bloom & Co', Status: true },
      { Name: 'Lumière', Status: false },
      { Name: 'Sweet Tier Bakery', Status: false },
    ],
  },
  budget: {
    columns: ['Category', 'Spent', 'Cap'],
    rows: [
      { Category: 'Venue', Spent: 8000, Cap: 8000 },
      { Category: 'Catering', Spent: 6200, Cap: 7000 },
      { Category: 'Photography', Spent: 3000, Cap: 3000 },
      { Category: 'Flowers', Spent: 1400, Cap: 2000 },
    ],
  },
}

// Schemaless documents -- note these vary in shape (extra `Notes`/`Tags` fields)
// to show off the JSONB document store.
export const stores = {
  inventory: [
    { Title: 'Folding Chairs', Category: 'Furniture', Count: 120, Price: '$2.50', 'Related Vendor': 'EventCo Rentals' },
    { Title: 'Round Tables', Category: 'Furniture', Count: 15, Price: '$12.00', 'Related Vendor': 'EventCo Rentals', Notes: 'Seats 8 each' },
    { Title: 'Centerpieces', Category: 'Decor', Count: 15, Price: '$45.00', 'Related Vendor': 'Bloom & Co', Tags: ['seasonal', 'fragile'] },
    { Title: 'String Lights', Category: 'Decor', Count: 30, Price: '$8.00', 'Related Vendor': 'Lumière' },
  ],
}
