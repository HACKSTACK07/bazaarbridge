/**
 * BazaarBridge - Comprehensive Sample Database Seed Script (Phase 1 / Gate 1)
 * Idempotent: Can be run multiple times safely.
 * All monetary values are integer paise.
 * All data labeled SAMPLE.
 */

const bcrypt = require('bcryptjs');
const { pool } = require('../db');

async function seed() {
  const client = await pool.connect();
  console.log('--- Starting BazaarBridge Database Seed ---');

  try {
    await client.query('BEGIN');

    // 1. Users (Demo Customer & Admin)
    console.log('Seeding demo accounts...');
    const customerPasswordHash = await bcrypt.hash('Demo@1234', 10);
    const adminPassword = process.env.SEED_ADMIN_PASSWORD || 'Admin@1234';
    const adminPasswordHash = await bcrypt.hash(adminPassword, 10);

    const userRes = await client.query(`
      INSERT INTO users (name, email, password_hash, role)
      VALUES 
        ('Demo Customer', 'demo@bazaarbridge.dev', $1, 'customer'),
        ('Store Admin', 'admin@bazaarbridge.dev', $2, 'admin')
      ON CONFLICT (email) DO UPDATE 
        SET password_hash = EXCLUDED.password_hash,
            name = EXCLUDED.name,
            role = EXCLUDED.role
      RETURNING user_id, email, role;
    `, [customerPasswordHash, adminPasswordHash]);
    console.log(`Seeded ${userRes.rowCount} users.`);

    // 2. Stock Locations
    console.log('Seeding stock locations...');
    const locationsData = [
      { name: 'Bangalore Central Warehouse', city: 'Bangalore', state: 'Karnataka', type: 'warehouse', is_home: true, is_sellable: true },
      { name: 'Koramangala Hub', city: 'Bangalore', state: 'Karnataka', type: 'hub', is_home: false, is_sellable: true },
      { name: 'Indiranagar Hub', city: 'Bangalore', state: 'Karnataka', type: 'hub', is_home: false, is_sellable: true },
      { name: 'Mysuru Transit Hub', city: 'Mysuru', state: 'Karnataka', type: 'holding', is_home: false, is_sellable: true },
      { name: 'Bangalore Quarantine Dock', city: 'Bangalore', state: 'Karnataka', type: 'quarantine', is_home: false, is_sellable: false }
    ];

    const locMap = {};
    for (const loc of locationsData) {
      const res = await client.query(`
        INSERT INTO stock_locations (name, city, state, location_type, is_home, is_sellable)
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (location_id) DO NOTHING
        RETURNING location_id;
      `, [loc.name, loc.city, loc.state, loc.type, loc.is_home, loc.is_sellable]);

      let locId;
      if (res.rowCount > 0) {
        locId = res.rows[0].location_id;
      } else {
        const find = await client.query('SELECT location_id FROM stock_locations WHERE name = $1', [loc.name]);
        locId = find.rows[0].location_id;
      }
      locMap[loc.name] = locId;
    }

    // 3. Fulfilment Hubs & Service Areas
    console.log('Seeding fulfilment hubs & PIN codes...');
    const hubsData = [
      {
        locName: 'Koramangala Hub',
        address: '80 Feet Rd, Koramangala 4th Block, Bangalore, Karnataka 560034',
        hours: JSON.stringify({ open: '08:00', close: '22:00' }),
        active: true,
        capacity: 50,
        radius: 8.5,
        pins: ['560034', '560095', '560001']
      },
      {
        locName: 'Indiranagar Hub',
        address: '100 Feet Rd, Indiranagar, Bangalore, Karnataka 560038',
        hours: JSON.stringify({ open: '08:00', close: '22:00' }),
        active: true,
        capacity: 40,
        radius: 7.0,
        pins: ['560038', '560008', '560075']
      }
    ];

    for (const hub of hubsData) {
      const locId = locMap[hub.locName];
      const hubRes = await client.query(`
        INSERT INTO fulfilment_hubs (location_id, address, hours, active, order_capacity, delivery_radius_km)
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (location_id) DO UPDATE 
          SET address = EXCLUDED.address,
              hours = EXCLUDED.hours,
              active = EXCLUDED.active,
              order_capacity = EXCLUDED.order_capacity,
              delivery_radius_km = EXCLUDED.delivery_radius_km
        RETURNING hub_id;
      `, [locId, hub.address, hub.hours, hub.active, hub.capacity, hub.radius]);

      const hubId = hubRes.rows[0].hub_id;
      for (const pin of hub.pins) {
        await client.query(`
          INSERT INTO hub_service_areas (hub_id, pin_code)
          VALUES ($1, $2)
          ON CONFLICT (pin_code) DO UPDATE SET hub_id = EXCLUDED.hub_id;
        `, [hubId, pin]);
      }
    }

    // 4. Categories (5 Categories)
    console.log('Seeding categories...');
    const categories = [
      'Electronics',
      'Audio & Wearables',
      'Smart Home & Appliances',
      'Computing & Accessories',
      'Gaming & Gear'
    ];
    const catMap = {};
    for (const cat of categories) {
      const res = await client.query(`
        INSERT INTO categories (category_name)
        VALUES ($1)
        ON CONFLICT (category_name) DO UPDATE SET category_name = EXCLUDED.category_name
        RETURNING category_id;
      `, [cat]);
      catMap[cat] = res.rows[0].category_id;
    }

    // 5. Dealers (5 Bangalore Dealers + 1 Mysuru Dealer)
    console.log('Seeding dealers...');
    const dealersData = [
      { name: 'Apex Retailers', city: 'Bangalore', state: 'Karnataka', rating: 4.8, reviews: 340, verified: true },
      { name: 'QuickTech Koramangala', city: 'Bangalore', state: 'Karnataka', rating: 4.5, reviews: 195, verified: true },
      { name: 'South City Electronics', city: 'Bangalore', state: 'Karnataka', rating: 4.2, reviews: 88, verified: true },
      { name: 'Indiranagar Digital Store', city: 'Bangalore', state: 'Karnataka', rating: 4.6, reviews: 220, verified: true },
      { name: 'Brigade Gadget Zone', city: 'Bangalore', state: 'Karnataka', rating: 3.9, reviews: 54, verified: false },
      { name: 'Mysuru Tech Emporium', city: 'Mysuru', state: 'Karnataka', rating: 4.4, reviews: 112, verified: true }
    ];
    const dealerMap = {};
    for (const d of dealersData) {
      const res = await client.query(`
        INSERT INTO dealers (shop_name, city, state, dealer_rating, total_reviews, verified, supplier_status)
        VALUES ($1, $2, $3, $4, $5, $6, 'active')
        RETURNING dealer_id;
      `, [d.name, d.city, d.state, d.rating, d.reviews, d.verified]);
      dealerMap[d.name] = res.rows[0].dealer_id;
    }

    // 6. Products (40 Products across 5 Categories)
    console.log('Seeding 40 products...');
    const productCatalog = [
      // Category: Audio & Wearables (8 products)
      { name: 'EchoSonic Pulse Bluetooth Speaker', cat: 'Audio & Wearables', brand: 'EchoSonic', desc: 'Portable wireless speaker with 360 audio and deep bass. SAMPLE.', isSpecialSpeaker: true },
      { name: 'AeroBuds Pro Active ANC', cat: 'Audio & Wearables', brand: 'AeroSound', desc: 'Premium noise-cancelling earbuds with transparency mode. SAMPLE.' },
      { name: 'BassMaster 500 Wireless Headphones', cat: 'Audio & Wearables', brand: 'BassMaster', desc: 'Over-ear studio wireless headphones with 40mm drivers. SAMPLE.' },
      { name: 'PulseFit Track Watch Pro', cat: 'Audio & Wearables', brand: 'PulseFit', desc: 'AMOLED fitness smartwatch with SpO2 and GPS tracking. SAMPLE.' },
      { name: 'SoundBar Ultra 120W Dolby', cat: 'Audio & Wearables', brand: 'EchoSonic', desc: '2.1 channel soundbar with wireless subwoofer. SAMPLE.' },
      { name: 'SmartBand Active Mini', cat: 'Audio & Wearables', brand: 'PulseFit', desc: 'Compact fitness band with 14-day battery life. SAMPLE.', isSingleUnit: true },
      { name: 'RetroVibe Wireless Neckband', cat: 'Audio & Wearables', brand: 'AeroSound', desc: 'Magnetic sports neckband with fast charging. SAMPLE.' },
      { name: 'StudioMic Streamer Pro', cat: 'Audio & Wearables', brand: 'BassMaster', desc: 'USB condenser microphone with cardioid pickup. SAMPLE.' },

      // Category: Electronics (8 products)
      { name: 'Lumina 55-inch 4K UHD Smart TV', cat: 'Electronics', brand: 'Lumina', desc: 'Ultra HD HDR10+ Smart Android TV. SAMPLE.' },
      { name: 'VisiCam 4K Action Camera', cat: 'Electronics', brand: 'VisiCam', desc: 'Waterproof 4K action camera with stabilization. SAMPLE.' },
      { name: 'OptiShield Home Security Camera 2K', cat: 'Electronics', brand: 'OptiShield', desc: '360 degree pan/tilt indoor smart security camera. SAMPLE.' },
      { name: 'PowerVault 20000mAh 65W PD Bank', cat: 'Electronics', brand: 'PowerVault', desc: 'Fast charging high capacity power bank for laptops and phones. SAMPLE.' },
      { name: 'SoundStage Pocket FM & MP3 Player', cat: 'Electronics', brand: 'RetroSound', desc: 'Compact digital pocket FM radio with SD playback. SAMPLE.' },
      { name: 'VoltMaster Universal Travel Adapter 65W', cat: 'Electronics', brand: 'VoltMaster', desc: 'All-in-one universal travel adapter with GaN tech. SAMPLE.' },
      { name: 'ChargeDock 3-in-1 Wireless Station', cat: 'Electronics', brand: 'VoltMaster', desc: 'Magnetic 15W wireless charging pad for phone, watch, buds. SAMPLE.' },
      { name: 'AuraGlow Smart LED Projector 1080p', cat: 'Electronics', brand: 'Lumina', desc: 'Full HD portable smart projector with built-in speakers. SAMPLE.' },

      // Category: Smart Home & Appliances (8 products)
      { name: 'AeroPure Air Purifier HEPA H13', cat: 'Smart Home & Appliances', brand: 'AeroPure', desc: 'Smart room air purifier with real-time PM2.5 display. SAMPLE.' },
      { name: 'AquaSmart UV+UF Water Purifier 8L', cat: 'Smart Home & Appliances', brand: 'AquaSmart', desc: 'Multi-stage domestic water purifier with mineral booster. SAMPLE.' },
      { name: 'RoboClean Max Vacuum & Mop', cat: 'Smart Home & Appliances', brand: 'RoboClean', desc: 'LiDAR navigation robotic vacuum cleaner and smart mop. SAMPLE.' },
      { name: 'ThermoSense Smart Room Heater', cat: 'Smart Home & Appliances', brand: 'ThermoSense', desc: 'Ceramic oscillating PTC room heater with remote. SAMPLE.' },
      { name: 'SmartMist Ultrasonic Humidifier 4L', cat: 'Smart Home & Appliances', brand: 'AeroPure', desc: 'Whisper-quiet cool mist humidifier with aroma diffuser. SAMPLE.' },
      { name: 'GlowSmart RGB WiFi Ambient Light Bar', cat: 'Smart Home & Appliances', brand: 'GlowSmart', desc: 'App-controlled smart ambient light bars with music sync. SAMPLE.' },
      { name: 'BreezeAir BLDC High-Speed Table Fan', cat: 'Smart Home & Appliances', brand: 'BreezeAir', desc: 'Energy saving whisper silent BLDC motor desk fan. SAMPLE.' },
      { name: 'SafeTouch Smart Door Lock Fingerprint', cat: 'Smart Home & Appliances', brand: 'OptiShield', desc: 'Keyless entry biometric digital door lock with keypad. SAMPLE.' },

      // Category: Computing & Accessories (8 products)
      { name: 'UltraSlim Mechanical Keyboard RGB', cat: 'Computing & Accessories', brand: 'KeyCraft', desc: 'Low-profile wireless mechanical keyboard with hot-swap switches. SAMPLE.' },
      { name: 'ErgoGlide Precision Wireless Mouse', cat: 'Computing & Accessories', brand: 'ErgoTech', desc: 'Ergonomic rechargeable vertical wireless mouse. SAMPLE.' },
      { name: 'TypeC Pro 9-in-1 Aluminum Dock', cat: 'Computing & Accessories', brand: 'ConnectPro', desc: 'USB-C multiport hub with 4K HDMI, Gigabit LAN, 100W PD. SAMPLE.' },
      { name: 'DeskMaster Dual Monitor Arm Gas-Spring', cat: 'Computing & Accessories', brand: 'ErgoTech', desc: 'Heavy-duty full motion dual monitor desk mount. SAMPLE.' },
      { name: 'SpeedFast 1TB NVMe Gen4 Portable SSD', cat: 'Computing & Accessories', brand: 'DataPro', desc: 'High-speed external solid state drive up to 2000MB/s. SAMPLE.' },
      { name: 'ClearView 2K Quad-HD Webcam with Mic', cat: 'Computing & Accessories', brand: 'ConnectPro', desc: 'Autofocus wide-angle web camera with privacy shutter. SAMPLE.' },
      { name: 'FeltPro Desk Mat XXL Waterproof', cat: 'Computing & Accessories', brand: 'KeyCraft', desc: 'Premium extended desk pad with non-slip rubber base. SAMPLE.' },
      { name: 'MagStand Magnetic Laptop Riser', cat: 'Computing & Accessories', brand: 'ErgoTech', desc: 'Foldable aluminum laptop stand with ventilation cooling. SAMPLE.' },

      // Category: Gaming & Gear (8 products)
      { name: 'NitroBlast Gaming Headset 7.1', cat: 'Gaming & Gear', brand: 'NitroGear', desc: 'Virtual 7.1 surround sound gaming headphones with mic. SAMPLE.' },
      { name: 'Vortex G70 Optical Gaming Mouse 16000DPI', cat: 'Gaming & Gear', brand: 'NitroGear', desc: 'Lightweight honeycomb RGB wired esports gaming mouse. SAMPLE.' },
      { name: 'StrikeForce Wireless Gamepad Controller', cat: 'Gaming & Gear', brand: 'NitroGear', desc: 'Hall-effect trigger wireless controller for PC and Mobile. SAMPLE.' },
      { name: 'HyperPad RGB Gaming Mousepad Extended', cat: 'Gaming & Gear', brand: 'NitroGear', desc: 'Micro-textured cloth surface gaming pad with 14 RGB modes. SAMPLE.' },
      { name: 'ApexArcade FightStick Pro USB', cat: 'Gaming & Gear', brand: 'RetroPlay', desc: 'Arcade fight stick with Sanwa parts and turbo switches. SAMPLE.' },
      { name: 'AeroCool RGB Laptop Cooling Pad', cat: 'Gaming & Gear', brand: 'NitroGear', desc: 'Dual 140mm turbo fan cooling mat for gaming laptops. SAMPLE.' },
      { name: 'GameCapture 4K60 HDR Pass-through Card', cat: 'Gaming & Gear', brand: 'ConnectPro', desc: 'External USB 3.0 video capture card for low-latency streaming. SAMPLE.' },
      { name: 'RetroConsole Mini 1000 Classic Games', cat: 'Gaming & Gear', brand: 'RetroPlay', desc: 'Plug and play HDMI retro video game console with 2 gamepads. SAMPLE.' }
    ];

    let specialSpeakerOfferIds = [];

    for (const p of productCatalog) {
      const prodRes = await client.query(`
        INSERT INTO products (name, description, brand, category_id, specs)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING product_id;
      `, [p.name, p.desc, p.brand, catMap[p.cat], JSON.stringify({ sample: true, brand: p.brand })]);
      const prodId = prodRes.rows[0].product_id;

      if (p.isSpecialSpeaker) {
        // EXACTLY 5 Offers for EchoSonic Pulse Bluetooth Speaker:
        // 1. Budget: lowest price (249900 paise = ₹2499)
        // 2. Fastest: Quick delivery mode, stocked at Koramangala Hub
        // 3. Rated: Apex Retailers (highest dealer rating 4.8)
        // 4. Value: best value proposition (balance of price, rating, warranty)
        // 5. Available: largest in-stock inventory quantity
        const speakerOffers = [
          {
            dealer: 'South City Electronics',
            purchase: 180000n,
            selling: 249900n, // ₹2,499 (Budget)
            modes: ['standard'],
            deliveryDays: 3,
            warranty: 6,
            warrantyNote: '6 Months Brand Warranty',
            stockQty: 8,
            hubQty: 0
          },
          {
            dealer: 'QuickTech Koramangala',
            purchase: 220000n,
            selling: 289900n, // Fastest (Quick delivery eligible)
            modes: ['quick', 'standard'],
            deliveryDays: 1,
            warranty: 12,
            warrantyNote: '1 Year Warranty + 30-min Delivery Eligible',
            stockQty: 4,
            hubQty: 10 // In Koramangala Hub for Quick mode!
          },
          {
            dealer: 'Apex Retailers',
            purchase: 230000n,
            selling: 299900n, // Highest Rated (4.8 rating)
            modes: ['standard'],
            deliveryDays: 2,
            warranty: 24,
            warrantyNote: '2 Years Extended Dealer Warranty',
            stockQty: 12,
            hubQty: 0
          },
          {
            dealer: 'Indiranagar Digital Store',
            purchase: 200000n,
            selling: 269900n, // Best Value
            modes: ['standard'],
            deliveryDays: 2,
            warranty: 18,
            warrantyNote: '18 Months Comprehensive Warranty',
            stockQty: 15,
            hubQty: 0
          },
          {
            dealer: 'Brigade Gadget Zone',
            purchase: 210000n,
            selling: 279900n, // Highest Available Stock
            modes: ['standard'],
            deliveryDays: 2,
            warranty: 12,
            warrantyNote: '1 Year Official Warranty',
            stockQty: 45, // 45 units available
            hubQty: 0
          }
        ];

        for (const off of speakerOffers) {
          const offRes = await client.query(`
            INSERT INTO dealer_offers (
              product_id, dealer_id, purchase_price, selling_price,
              status, bangalore_delivery_days, transfer_days_min, transfer_days_max,
              eligible_modes, warranty_months, warranty_note
            )
            VALUES ($1, $2, $3, $4, 'active', $5, 1, 3, $6, $7, $8)
            RETURNING offer_id;
          `, [
            prodId,
            dealerMap[off.dealer],
            off.purchase.toString(),
            off.selling.toString(),
            off.deliveryDays,
            off.modes,
            off.warranty,
            off.warrantyNote
          ]);
          const offerId = offRes.rows[0].offer_id;
          specialSpeakerOfferIds.push(offerId);

          // Stock in Central Warehouse
          await client.query(`
            INSERT INTO inventory (offer_id, location_id, quantity, reserved_quantity)
            VALUES ($1, $2, $3, 0)
            ON CONFLICT (offer_id, location_id) DO UPDATE SET quantity = EXCLUDED.quantity;
          `, [offerId, locMap['Bangalore Central Warehouse'], off.stockQty]);

          // Stock in Koramangala Hub if applicable
          if (off.hubQty > 0) {
            await client.query(`
              INSERT INTO inventory (offer_id, location_id, quantity, reserved_quantity)
              VALUES ($1, $2, $3, 0)
              ON CONFLICT (offer_id, location_id) DO UPDATE SET quantity = EXCLUDED.quantity;
            `, [offerId, locMap['Koramangala Hub'], off.hubQty]);
          }

          // Initial price history
          await client.query(`
            INSERT INTO offer_price_history (offer_id, selling_price, valid_from, valid_to)
            VALUES ($1, $2, now(), null)
            ON CONFLICT DO NOTHING;
          `, [offerId, off.selling.toString()]);
        }
      } else if (p.isSingleUnit) {
        // Concurrency test product: exactly 1 unit available
        const offRes = await client.query(`
          INSERT INTO dealer_offers (
            product_id, dealer_id, purchase_price, selling_price,
            status, bangalore_delivery_days, transfer_days_min, transfer_days_max,
            eligible_modes, warranty_months, warranty_note
          )
          VALUES ($1, $2, 99900, 149900, 'active', 2, 1, 2, '{standard}', 12, '1 Year Warranty')
          RETURNING offer_id;
        `, [prodId, dealerMap['Apex Retailers']]);
        const offerId = offRes.rows[0].offer_id;

        await client.query(`
          INSERT INTO inventory (offer_id, location_id, quantity, reserved_quantity)
          VALUES ($1, $2, 1, 0)
          ON CONFLICT (offer_id, location_id) DO UPDATE SET quantity = 1;
        `, [offerId, locMap['Bangalore Central Warehouse']]);

        await client.query(`
          INSERT INTO offer_price_history (offer_id, selling_price, valid_from, valid_to)
          VALUES ($1, 149900, now(), null)
          ON CONFLICT DO NOTHING;
        `, [offerId]);
      } else {
        // Standard product: 2 to 3 offers
        const dealers = ['Apex Retailers', 'QuickTech Koramangala', 'Indiranagar Digital Store'];
        const basePrice = Math.floor(Math.random() * 8000 + 1500) * 100; // 1,500 to 9,500 rupees
        
        for (let i = 0; i < 2; i++) {
          const dName = dealers[i];
          const selling = BigInt(basePrice + i * 20000); // slight variance
          const purchase = selling * 80n / 100n;
          const isQuick = i === 1; // 2nd offer has quick eligibility
          const modes = isQuick ? ['quick', 'standard'] : ['standard'];

          const offRes = await client.query(`
            INSERT INTO dealer_offers (
              product_id, dealer_id, purchase_price, selling_price,
              status, bangalore_delivery_days, transfer_days_min, transfer_days_max,
              eligible_modes, warranty_months, warranty_note
            )
            VALUES ($1, $2, $3, $4, 'active', 2, 1, 3, $5, 12, '1 Year Manufacturer Warranty')
            RETURNING offer_id;
          `, [prodId, dealerMap[dName], purchase.toString(), selling.toString(), modes]);
          const offerId = offRes.rows[0].offer_id;

          // Add inventory to Bangalore warehouse
          await client.query(`
            INSERT INTO inventory (offer_id, location_id, quantity, reserved_quantity)
            VALUES ($1, $2, $3, 0)
            ON CONFLICT (offer_id, location_id) DO UPDATE SET quantity = EXCLUDED.quantity;
          `, [offerId, locMap['Bangalore Central Warehouse'], 10 + i * 5]);

          // If quick eligible, also add inventory to Koramangala or Indiranagar Hub
          if (isQuick) {
            await client.query(`
              INSERT INTO inventory (offer_id, location_id, quantity, reserved_quantity)
              VALUES ($1, $2, 6, 0)
              ON CONFLICT (offer_id, location_id) DO UPDATE SET quantity = 6;
            `, [offerId, locMap['Koramangala Hub']]);
          }

          // Price history
          await client.query(`
            INSERT INTO offer_price_history (offer_id, selling_price, valid_from, valid_to)
            VALUES ($1, $2, now(), null)
            ON CONFLICT DO NOTHING;
          `, [offerId, selling.toString()]);
        }
      }
    }

    await client.query('COMMIT');
    console.log('--- Database Seed Completed Successfully! ---');
    console.log('Seeded:');
    console.log('- 2 Demo Accounts (demo@bazaarbridge.dev, admin@bazaarbridge.dev)');
    console.log('- 5 Stock Locations (Warehouse, 2 Hubs, Holding, Quarantine)');
    console.log('- 2 Fulfilment Hubs with 6 Serviced PIN Codes');
    console.log('- 5 Categories');
    console.log('- 6 Dealers (5 Bangalore, 1 Mysuru)');
    console.log('- 40 Products across categories');
    console.log('- EchoSonic Pulse Bluetooth Speaker with 5 specialized comparison offers');
    console.log('- SmartBand Active Mini with 1 unit available for concurrency testing');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Seed failed:', err);
    throw err;
  } finally {
    client.release();
  }
}

if (require.main === module) {
  seed().then(() => {
    process.exit(0);
  }).catch(() => {
    process.exit(1);
  });
}

module.exports = { seed };
