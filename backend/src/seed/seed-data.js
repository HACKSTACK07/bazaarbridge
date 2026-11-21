// backend/src/seed/seed-data.js
// Authoritative synthetic SAMPLE seed data for BazaarBridge (Version 7.2)
// Strictly follows schema.sql, agent-rules.md, api-contract.md, service-contracts.md

const crypto = require('crypto');

// Verified standard bcrypt hashes (cost factor 10)
const BCRYPT_HASHES = {
  'Demo@1234': '$2b$10$nd//QBHpeqbCZwi4d51QRe/L2vqStvl8JMIuDx/CRoG6Dh6EwdHqK',
  'Admin@1234': '$2b$10$9lVaOKWOBDRSfreCyD9jf.wLOHABykUM0Wl5l2rO9XGEGM2TsE216',
  'Rider@1234': '$2b$10$KDu1mFsxWZYbj3ZeCuWX6O5p4NiMAFkrCXTFCekiKDRF4hnKVFykq'
};

// ============================================================================
// 1. STOCK LOCATIONS
// - Bangalore warehouse (is_home, sellable)
// - Bangalore Express Hub (hub, sellable)
// - Quarantine (NOT sellable)
// - Mysuru regional holding (holding, sellable)
// ============================================================================
const stockLocations = [
  {
    location_id: '10000000-0000-0000-0000-000000000001',
    name: 'Bangalore Central Warehouse (SAMPLE)',
    city: 'Bangalore',
    state: 'Karnataka',
    location_type: 'warehouse',
    is_home: true,
    is_sellable: true
  },
  {
    location_id: '10000000-0000-0000-0000-000000000002',
    name: 'Bangalore Express Hub (SAMPLE)',
    city: 'Bangalore',
    state: 'Karnataka',
    location_type: 'hub',
    is_home: false,
    is_sellable: true
  },
  {
    location_id: '10000000-0000-0000-0000-000000000003',
    name: 'Bangalore Quarantine Facility (SAMPLE)',
    city: 'Bangalore',
    state: 'Karnataka',
    location_type: 'quarantine',
    is_home: false,
    is_sellable: false
  },
  {
    location_id: '10000000-0000-0000-0000-000000000004',
    name: 'Mysuru Regional Holding (SAMPLE)',
    city: 'Mysuru',
    state: 'Karnataka',
    location_type: 'holding',
    is_home: false,
    is_sellable: true
  }
];

// ============================================================================
// 2. FULFILMENT HUBS & SERVICE AREAS
// One Hub with 3 sample PIN codes, operating hours and order_capacity
// ============================================================================
const fulfilmentHubs = [
  {
    hub_id: '20000000-0000-0000-0000-000000000001',
    location_id: '10000000-0000-0000-0000-000000000002', // Bangalore Express Hub
    address: '100 Feet Road, HAL 2nd Stage, Indiranagar, Bangalore, Karnataka (SAMPLE)',
    hours: {
      open: '08:00',
      close: '22:00',
      timezone: 'Asia/Kolkata',
      days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
    },
    active: true,
    order_capacity: 50,
    delivery_radius_km: 12.5
  }
];

const hubServiceAreas = [
  { area_id: '21000000-0000-0000-0000-000000000001', hub_id: '20000000-0000-0000-0000-000000000001', pin_code: '560001' }, // Bangalore GPO / MG Road
  { area_id: '21000000-0000-0000-0000-000000000002', hub_id: '20000000-0000-0000-0000-000000000001', pin_code: '560038' }, // Indiranagar
  { area_id: '21000000-0000-0000-0000-000000000003', hub_id: '20000000-0000-0000-0000-000000000001', pin_code: '560025' }  // Richmond Town
];

// ============================================================================
// 3. USERS & CARTS
// Demo accounts: Customer + Admin + Rider with secure bcrypt password hashes
// ============================================================================
function getUsers(adminPasswordOverride) {
  return [
    {
      user_id: '30000000-0000-0000-0000-000000000001',
      name: 'Demo Customer (SAMPLE)',
      email: 'demo@bazaarbridge.dev',
      password: 'Demo@1234',
      password_hash: BCRYPT_HASHES['Demo@1234'],
      role: 'customer'
    },
    {
      user_id: '30000000-0000-0000-0000-000000000002',
      name: 'System Admin (SAMPLE)',
      email: 'admin@bazaarbridge.dev',
      password: adminPasswordOverride || 'Admin@1234',
      password_hash: BCRYPT_HASHES['Admin@1234'],
      role: 'admin'
    },
    {
      user_id: '30000000-0000-0000-0000-000000000003',
      name: 'Express Rider Ramesh (SAMPLE)',
      email: 'rider@bazaarbridge.dev',
      password: 'Rider@1234',
      password_hash: BCRYPT_HASHES['Rider@1234'],
      role: 'rider'
    }
  ];
}

const carts = [
  { cart_id: '35000000-0000-0000-0000-000000000001', user_id: '30000000-0000-0000-0000-000000000001' },
  { cart_id: '35000000-0000-0000-0000-000000000002', user_id: '30000000-0000-0000-0000-000000000002' },
  { cart_id: '35000000-0000-0000-0000-000000000003', user_id: '30000000-0000-0000-0000-000000000003' }
];

// ============================================================================
// 4. DEALERS
// 5 Bangalore dealers with distinct ratings and review counts + 1 Mysuru dealer
// Calibrated for Bluetooth speaker 5-offer comparison test:
// - Dealer 1: 4.8★ / 340 reviews
// - Dealer 2: 4.1★ / 80 reviews
// - Dealer 3: 4.4★ / 150 reviews
// - Dealer 4: 4.3★ / 110 reviews
// - Dealer 5: 3.9★ / 42 reviews
// - Dealer 6 (Mysuru): 4.5★ / 96 reviews
// ============================================================================
const dealers = [
  {
    dealer_id: '40000000-0000-0000-0000-000000000001',
    shop_name: 'Apex Electronics Koramangala (SAMPLE)',
    city: 'Bangalore',
    state: 'Karnataka',
    contact: '+91 98450 11001',
    dealer_rating: 4.8,
    total_reviews: 340,
    verified: true,
    supplier_status: 'active'
  },
  {
    dealer_id: '40000000-0000-0000-0000-000000000002',
    shop_name: 'Brigade Tech & Sound (SAMPLE)',
    city: 'Bangalore',
    state: 'Karnataka',
    contact: '+91 98450 22002',
    dealer_rating: 4.1,
    total_reviews: 80,
    verified: true,
    supplier_status: 'active'
  },
  {
    dealer_id: '40000000-0000-0000-0000-000000000003',
    shop_name: 'Indiranagar Digital Mart (SAMPLE)',
    city: 'Bangalore',
    state: 'Karnataka',
    contact: '+91 98450 33003',
    dealer_rating: 4.4,
    total_reviews: 150,
    verified: true,
    supplier_status: 'active'
  },
  {
    dealer_id: '40000000-0000-0000-0000-000000000004',
    shop_name: 'Whitefield Prime Gadgets (SAMPLE)',
    city: 'Bangalore',
    state: 'Karnataka',
    contact: '+91 98450 44004',
    dealer_rating: 4.3,
    total_reviews: 110,
    verified: false,
    supplier_status: 'active'
  },
  {
    dealer_id: '40000000-0000-0000-0000-000000000005',
    shop_name: 'Jayanagar Value Bazaar (SAMPLE)',
    city: 'Bangalore',
    state: 'Karnataka',
    contact: '+91 98450 55005',
    dealer_rating: 3.9,
    total_reviews: 42,
    verified: true,
    supplier_status: 'active'
  },
  {
    dealer_id: '40000000-0000-0000-0000-000000000006',
    shop_name: 'Chamundi Retail & Audio (SAMPLE)',
    city: 'Mysuru',
    state: 'Karnataka',
    contact: '+91 821 2400006',
    dealer_rating: 4.5,
    total_reviews: 96,
    verified: true,
    supplier_status: 'active'
  }
];

// ============================================================================
// 5. CATEGORIES (5 Categories)
// ============================================================================
const categories = [
  {
    category_id: '50000000-0000-0000-0000-000000000001',
    category_name: 'Audio & Headphones'
  },
  {
    category_id: '50000000-0000-0000-0000-000000000002',
    category_name: 'Mobiles & Accessories'
  },
  {
    category_id: '50000000-0000-0000-0000-000000000003',
    category_name: 'Computers & Peripherals'
  },
  {
    category_id: '50000000-0000-0000-0000-000000000004',
    category_name: 'Cameras & Photography'
  },
  {
    category_id: '50000000-0000-0000-0000-000000000005',
    category_name: 'Wearables & Smart Home'
  }
];

// ============================================================================
// 6. PRODUCTS (40 Products across 5 categories, 8 per category)
// Product 1: Comparison Bluetooth speaker
// Product 2: Mixed-cart demo product (both Hub and Warehouse stock)
// Product 3: Bluetooth earphones sold by Mysuru dealer (searches for 'bluetoth' & city=Mysuru)
// ============================================================================
const products = [
  // --- Category 1: Audio & Headphones (8 products) ---
  {
    product_id: '60000000-0000-0000-0000-000000000001',
    name: 'EchoPulse Boom 360 Portable Bluetooth Speaker (SAMPLE)',
    description: 'Rugged waterproof Bluetooth 5.3 portable speaker with 360-degree sound, 24-hour battery life, and IPX7 rating.',
    brand: 'EchoPulse',
    category_id: '50000000-0000-0000-0000-000000000001',
    specs: { power_watts: 20, battery_life_hours: 24, waterproof_rating: 'IPX7', bluetooth_version: '5.3', weight_grams: 540 }
  },
  {
    product_id: '60000000-0000-0000-0000-000000000002',
    name: 'BassMaster Wireless Noise-Cancelling Headphones (SAMPLE)',
    description: 'Over-ear wireless headphones with active noise cancellation, 40mm drivers, and 30-hour battery life.',
    brand: 'BassMaster',
    category_id: '50000000-0000-0000-0000-000000000001',
    specs: { driver_size_mm: 40, anc_enabled: true, battery_life_hours: 30, connectivity: 'Bluetooth 5.2' }
  },
  {
    product_id: '60000000-0000-0000-0000-000000000003',
    name: 'SonicAir True Wireless Bluetooth Earphones (SAMPLE)',
    description: 'Compact Bluetooth earphones with deep bass, low latency gaming mode, and 28-hour playtime with charging case.',
    brand: 'SonicAir',
    category_id: '50000000-0000-0000-0000-000000000001',
    specs: { driver_size_mm: 10, playtime_hours: 28, water_resistance: 'IPX5', bluetooth_version: '5.3' }
  },
  {
    product_id: '60000000-0000-0000-0000-000000000004',
    name: 'StudioPro USB Condenser Studio Microphone (SAMPLE)',
    description: 'Cardioid polar pattern USB condenser microphone for podcasting, streaming, and studio voice recording.',
    brand: 'StudioPro',
    category_id: '50000000-0000-0000-0000-000000000001',
    specs: { polar_pattern: 'Cardioid', sample_rate_khz: 192, bit_depth: 24, connector: 'USB-C' }
  },
  {
    product_id: '60000000-0000-0000-0000-000000000005',
    name: 'SoundWave 2.1 Channel Cinema Soundbar (SAMPLE)',
    description: '120W cinematic soundbar with wireless subwoofer, HDMI ARC, optical input, and Bluetooth 5.0 streaming.',
    brand: 'SoundWave',
    category_id: '50000000-0000-0000-0000-000000000001',
    specs: { total_output_watts: 120, channels: '2.1', subwoofer: 'Wireless', hdmi_arc: true }
  },
  {
    product_id: '60000000-0000-0000-0000-000000000006',
    name: 'ClearVoice Wireless Conference Speakerphone (SAMPLE)',
    description: '360-degree omnidirectional microphone array with AI noise reduction for clear business conference calls.',
    brand: 'ClearVoice',
    category_id: '50000000-0000-0000-0000-000000000001',
    specs: { mic_pickup_range_meters: 5, battery_hours: 18, connection: 'USB / Bluetooth' }
  },
  {
    product_id: '60000000-0000-0000-0000-000000000007',
    name: 'BeatBox Mini Clip Bluetooth Speaker (SAMPLE)',
    description: 'Ultra-portable clip-on mini Bluetooth speaker with carabiner clip and punchy audio output.',
    brand: 'BeatBox',
    category_id: '50000000-0000-0000-0000-000000000001',
    specs: { power_watts: 5, battery_hours: 10, waterproof_rating: 'IP67', clip_carabiner: true }
  },
  {
    product_id: '60000000-0000-0000-0000-000000000008',
    name: 'RetroHiFi Belt-Drive Vintage Vinyl Turntable (SAMPLE)',
    description: 'Classic wood-finish belt-drive turntable with built-in stereo preamp and wireless Bluetooth transmitter.',
    brand: 'RetroHiFi',
    category_id: '50000000-0000-0000-0000-000000000001',
    specs: { speeds_rpm: [33, 45], drive_type: 'Belt-drive', built_in_preamp: true, bluetooth_out: true }
  },

  // --- Category 2: Mobiles & Accessories (8 products) ---
  {
    product_id: '60000000-0000-0000-0000-000000000009',
    name: 'PixelGlide 5G Smartphone 128GB (SAMPLE)',
    description: '6.7-inch 120Hz AMOLED display, 50MP triple camera system, Snapdragon processor, and 5000mAh battery.',
    brand: 'PixelGlide',
    category_id: '50000000-0000-0000-0000-000000000002',
    specs: { screen_inches: 6.7, storage_gb: 128, ram_gb: 8, camera_mp: 50, battery_mah: 5000 }
  },
  {
    product_id: '60000000-0000-0000-0000-000000000010',
    name: 'MagCharge 15W Qi Fast Wireless Charging Pad (SAMPLE)',
    description: 'Slim aluminum wireless charging pad with magnetic alignment, LED indicator, and foreign object detection.',
    brand: 'MagCharge',
    category_id: '50000000-0000-0000-0000-000000000002',
    specs: { output_watts: 15, standard: 'Qi', connector: 'USB-C', material: 'Aluminum' }
  },
  {
    product_id: '60000000-0000-0000-0000-000000000011',
    name: 'UltraArmor Shockproof Heavy Duty Phone Case (SAMPLE)',
    description: 'Dual-layer military grade drop-tested protective bumper case with integrated tactile kickstand.',
    brand: 'UltraArmor',
    category_id: '50000000-0000-0000-0000-000000000002',
    specs: { drop_test_standard: 'MIL-STD-810G', material: 'Polycarbonate / TPU', kickstand: true }
  },
  {
    product_id: '60000000-0000-0000-0000-000000000012',
    name: 'PowerVault 20000mAh 65W PD Fast Power Bank (SAMPLE)',
    description: 'High-capacity power bank capable of charging laptops, phones, and tablets with 65W Power Delivery.',
    brand: 'PowerVault',
    category_id: '50000000-0000-0000-0000-000000000002',
    specs: { capacity_mah: 20000, max_output_watts: 65, ports: ['USB-C', 'USB-A x2'], display: 'Digital LED' }
  },
  {
    product_id: '60000000-0000-0000-0000-000000000013',
    name: 'ApexView 9H Tempered Glass Screen Protector Pack (SAMPLE)',
    description: 'Ultra-thin scratch resistant 9H hardness tempered glass with oleophobic coating against fingerprints.',
    brand: 'ApexView',
    category_id: '50000000-0000-0000-0000-000000000002',
    specs: { hardness: '9H', thickness_mm: 0.33, clarity: '99.9% HD', pack_size: 2 }
  },
  {
    product_id: '60000000-0000-0000-0000-000000000014',
    name: 'SwiftType Magnetic Foldable Desk Phone Stand (SAMPLE)',
    description: 'Fully adjustable dual-hinge aluminum desktop stand compatible with all smartphones and small tablets.',
    brand: 'SwiftType',
    category_id: '50000000-0000-0000-0000-000000000002',
    specs: { material: 'Anodized Aluminum', angle_adjustment_deg: 270, foldable: true }
  },
  {
    product_id: '60000000-0000-0000-0000-000000000015',
    name: 'CarMount Auto-Clamping Vent Phone Mount (SAMPLE)',
    description: 'Smart gravity sensor car air vent holder with one-handed automatic locking and silicone grip pads.',
    brand: 'CarMount',
    category_id: '50000000-0000-0000-0000-000000000002',
    specs: { mount_type: 'Air Vent', rotation: '360 degree ball joint', clamping: 'Gravity Auto' }
  },
  {
    product_id: '60000000-0000-0000-0000-000000000016',
    name: 'OmniCable 3-in-1 Nylon Braided Charging Cable (SAMPLE)',
    description: 'Durable 1.5m braided universal cable featuring Lightning, USB-C, and Micro-USB connectors.',
    brand: 'OmniCable',
    category_id: '50000000-0000-0000-0000-000000000002',
    specs: { length_meters: 1.5, connectors: ['Lightning', 'USB-C', 'Micro-USB'], current_amps: 3.0 }
  },

  // --- Category 3: Computers & Peripherals (8 products) ---
  {
    product_id: '60000000-0000-0000-0000-000000000017',
    name: 'ApexBook Pro 15.6 Laptop 16GB RAM 512GB SSD (SAMPLE)',
    description: 'Slim lightweight productivity laptop with Intel Core i7, 15.6-inch FHD anti-glare screen, and backlit keyboard.',
    brand: 'ApexBook',
    category_id: '50000000-0000-0000-0000-000000000003',
    specs: { processor: 'Intel Core i7-1355U', ram_gb: 16, storage_gb: 512, screen_inches: 15.6, weight_kg: 1.65 }
  },
  {
    product_id: '60000000-0000-0000-0000-000000000018',
    name: 'TactilePro RGB Mechanical Gaming Keyboard (SAMPLE)',
    description: 'Hot-swappable mechanical switches, per-key RGB backlighting, aluminum top plate, and detachable cable.',
    brand: 'TactilePro',
    category_id: '50000000-0000-0000-0000-000000000003',
    specs: { switch_type: 'Tactile Brown', layout: 'Tenkeyless (TKL)', rgb_lighting: true, interface: 'USB-C' }
  },
  {
    product_id: '60000000-0000-0000-0000-000000000019',
    name: 'PrecisionFlow Wireless Ergonomic Vertical Mouse (SAMPLE)',
    description: 'Ergonomic 57-degree vertical handshake design to alleviate wrist strain with 4000 DPI optical sensor.',
    brand: 'PrecisionFlow',
    category_id: '50000000-0000-0000-0000-000000000003',
    specs: { dpi: 4000, angle_deg: 57, battery_life_months: 24, connection: '2.4GHz + Bluetooth' }
  },
  {
    product_id: '60000000-0000-0000-0000-000000000020',
    name: 'UltraWide 27-inch 4K IPS Desktop Monitor (SAMPLE)',
    description: '3840x2160 UHD resolution, 99% sRGB color accuracy, HDR400, USB-C 65W charging port, and height-adjustable stand.',
    brand: 'UltraWide',
    category_id: '50000000-0000-0000-0000-000000000003',
    specs: { screen_size_inches: 27, resolution: '3840x2160 UHD', refresh_rate_hz: 75, panel: 'IPS', usb_c_pd: '65W' }
  },
  {
    product_id: '60000000-0000-0000-0000-000000000021',
    name: 'MultiPort 10-in-1 USB-C Hub Docking Station (SAMPLE)',
    description: 'Compact docking station with 4K HDMI, Gigabit Ethernet, SD card reader, 3x USB 3.0, and 100W PD pass-through.',
    brand: 'MultiPort',
    category_id: '50000000-0000-0000-0000-000000000003',
    specs: { ports_count: 10, hdmi_resolution: '4K@60Hz', ethernet_speed_mbps: 1000, pd_power_watts: 100 }
  },
  {
    product_id: '60000000-0000-0000-0000-000000000022',
    name: 'ClearStream 1080p 60fps Pro Streaming Webcam (SAMPLE)',
    description: 'Full HD streaming webcam with autofocus, dual stereo microphones, privacy shutter, and low-light enhancement.',
    brand: 'ClearStream',
    category_id: '50000000-0000-0000-0000-000000000003',
    specs: { resolution: '1080p', frame_rate_fps: 60, field_of_view_deg: 90, autofocus: true, privacy_shutter: true }
  },
  {
    product_id: '60000000-0000-0000-0000-000000000023',
    name: 'SwiftDrive 1TB Portable NVMe External SSD (SAMPLE)',
    description: 'Ultra-fast external SSD delivering up to 1050 MB/s read speeds, drop-resistant aluminum casing, and hardware encryption.',
    brand: 'SwiftDrive',
    category_id: '50000000-0000-0000-0000-000000000003',
    specs: { capacity_tb: 1, read_speed_mbps: 1050, interface: 'USB 3.2 Gen 2', drop_resistant_meters: 2 }
  },
  {
    product_id: '60000000-0000-0000-0000-000000000024',
    name: 'ErgoLift Aluminum Adjustable Laptop Riser (SAMPLE)',
    description: 'Ergonomic ventilated cooling stand with 6 adjustable height levels for laptops up to 17 inches.',
    brand: 'ErgoLift',
    category_id: '50000000-0000-0000-0000-000000000003',
    specs: { material: 'Solid Aluminum', max_laptop_size_inches: 17, height_levels: 6, weight_capacity_kg: 10 }
  },

  // --- Category 4: Cameras & Photography (8 products) ---
  {
    product_id: '60000000-0000-0000-0000-000000000025',
    name: 'AlphaCapture 4K Mirrorless Digital Camera (SAMPLE)',
    description: '24.2MP full-frame mirrorless camera with 5-axis image stabilization, 4K 60fps video, and dual SD card slots.',
    brand: 'AlphaCapture',
    category_id: '50000000-0000-0000-0000-000000000004',
    specs: { sensor: 'Full-Frame CMOS', megapixel: 24.2, video_resolution: '4K@60fps', ibis_axis: 5, mount: 'E-Mount' }
  },
  {
    product_id: '60000000-0000-0000-0000-000000000026',
    name: 'ActionCam 4K Waterproof Action Camera (SAMPLE)',
    description: 'Rugged action camera waterproof to 10m without case, dual color screens, HyperSmooth stabilization, and voice control.',
    brand: 'ActionCam',
    category_id: '50000000-0000-0000-0000-000000000004',
    specs: { video_resolution: '4K@60fps', waterproof_depth_meters: 10, dual_screen: true, stabilization: 'Electronic' }
  },
  {
    product_id: '60000000-0000-0000-0000-000000000027',
    name: 'HorizonPro 3-Axis Handheld Smartphone Gimbal (SAMPLE)',
    description: 'Motorized 3-axis stabilizer with AI face tracking, gesture controls, magnetic phone clamp, and 12-hour battery.',
    brand: 'HorizonPro',
    category_id: '50000000-0000-0000-0000-000000000004',
    specs: { axis_count: 3, tracking: 'AI Smart Tracking', battery_hours: 12, max_payload_grams: 290 }
  },
  {
    product_id: '60000000-0000-0000-0000-000000000028',
    name: 'HaloRing 12-inch Bi-Color LED Ring Light Kit (SAMPLE)',
    description: 'Dimmable studio ring light with adjustable color temperature (3200K-5600K), phone holder, and 2m extendable tripod.',
    brand: 'HaloRing',
    category_id: '50000000-0000-0000-0000-000000000004',
    specs: { diameter_inches: 12, color_temp_kelvin: '3200K-5600K', power_watts: 36, tripod_height_meters: 2.1 }
  },
  {
    product_id: '60000000-0000-0000-0000-000000000029',
    name: 'CarbonTravel Compact Heavy-Duty Tripod (SAMPLE)',
    description: 'Lightweight carbon fiber travel tripod with 360-degree panoramic ball head and quick release Arca-Swiss plate.',
    brand: 'CarbonTravel',
    category_id: '50000000-0000-0000-0000-000000000004',
    specs: { material: '8-layer Carbon Fiber', max_height_cm: 165, folded_length_cm: 42, load_capacity_kg: 12 }
  },
  {
    product_id: '60000000-0000-0000-0000-000000000030',
    name: 'ProFocus 50mm f/1.8 Prime Portrait Camera Lens (SAMPLE)',
    description: 'Sharp prime portrait lens with fast f/1.8 aperture, creamy background bokeh, and quiet stepping autofocus motor.',
    brand: 'ProFocus',
    category_id: '50000000-0000-0000-0000-000000000004',
    specs: { focal_length_mm: 50, max_aperture: 'f/1.8', filter_size_mm: 49, motor_type: 'STM Autofocus' }
  },
  {
    product_id: '60000000-0000-0000-0000-000000000031',
    name: 'MemoryPro 128GB UHS-II V60 SDXC High Speed Card (SAMPLE)',
    description: 'Professional high-speed memory card delivering 280 MB/s read and 150 MB/s write for 4K video recording.',
    brand: 'MemoryPro',
    category_id: '50000000-0000-0000-0000-000000000004',
    specs: { capacity_gb: 128, speed_class: 'V60 UHS-II U3', max_read_mbps: 280, max_write_mbps: 150 }
  },
  {
    product_id: '60000000-0000-0000-0000-000000000032',
    name: 'SkyDrone 4K Folding GPS Quadcopter Drone (SAMPLE)',
    description: 'Compact folding drone with 4K UHD stabilized camera, 31-minute flight time, GPS return-to-home, and 5km transmission.',
    brand: 'SkyDrone',
    category_id: '50000000-0000-0000-0000-000000000004',
    specs: { video_resolution: '4K@30fps', flight_time_mins: 31, transmission_range_km: 5, weight_grams: 249 }
  },

  // --- Category 5: Wearables & Smart Home (8 products) ---
  {
    product_id: '60000000-0000-0000-0000-000000000033',
    name: 'PulseTrack Pro GPS Fitness Smartwatch (SAMPLE)',
    description: '1.43-inch AMOLED display, built-in dual-band GPS, 24/7 heart rate and blood oxygen tracking, 14-day battery.',
    brand: 'PulseTrack',
    category_id: '50000000-0000-0000-0000-000000000005',
    specs: { display: '1.43 AMOLED', gps: 'Dual-Band', battery_days: 14, water_resistance: '5 ATM', sensors: ['HR', 'SpO2', 'Stress'] }
  },
  {
    product_id: '60000000-0000-0000-0000-000000000034',
    name: 'ActiveFit Smart Fitness Band Tracker (SAMPLE)',
    description: 'Slim lightweight fitness band with continuous health monitoring, 120 sports modes, and 18-day battery life.',
    brand: 'ActiveFit',
    category_id: '50000000-0000-0000-0000-000000000005',
    specs: { display: '1.1 AMOLED', sports_modes: 120, battery_days: 18, water_resistance: '5 ATM' }
  },
  {
    product_id: '60000000-0000-0000-0000-000000000035',
    name: 'SmartGlow Multi-Color WiFi LED Smart Bulb 9W (SAMPLE)',
    description: '16 million colors, voice control with Alexa and Google Assistant, dimmable without hub, B22 socket.',
    brand: 'SmartGlow',
    category_id: '50000000-0000-0000-0000-000000000005',
    specs: { wattage: 9, lumens: 800, base: 'B22', color_palette: '16 Million RGBW', connectivity: 'WiFi 2.4GHz' }
  },
  {
    product_id: '60000000-0000-0000-0000-000000000036',
    name: 'SafeGuard Smart 2K Video Doorbell with Wireless Chime (SAMPLE)',
    description: '2K HD video with infrared night vision, two-way audio, smart motion alerts, and plug-in indoor chime.',
    brand: 'SafeGuard',
    category_id: '50000000-0000-0000-0000-000000000005',
    specs: { resolution: '2K Quad HD', night_vision: 'Infrared', field_of_view_deg: 160, power: 'Rechargeable Battery' }
  },
  {
    product_id: '60000000-0000-0000-0000-000000000037',
    name: 'SmartPlug 16A Energy Monitoring WiFi Plug (SAMPLE)',
    description: 'Heavy duty 16A smart socket for geysers and ACs with live energy consumption tracking and scheduled timers.',
    brand: 'SmartPlug',
    category_id: '50000000-0000-0000-0000-000000000005',
    specs: { max_load_amps: 16, power_rating_watts: 3500, energy_metering: true, wifi_frequency: '2.4GHz' }
  },
  {
    product_id: '60000000-0000-0000-0000-000000000038',
    name: 'RoboVac Smart Laser Mapping Robotic Vacuum (SAMPLE)',
    description: 'LiDAR navigation with 4000Pa strong suction, 2-in-1 sweeping and mopping, virtual wall boundaries via mobile app.',
    brand: 'RoboVac',
    category_id: '50000000-0000-0000-0000-000000000005',
    specs: { suction_pa: 4000, navigation: 'LiDAR Laser', battery_mah: 5200, runtime_mins: 150, mopping: true }
  },
  {
    product_id: '60000000-0000-0000-0000-000000000039',
    name: 'ComfortAir Smart Ultrasonic Room Humidifier 4L (SAMPLE)',
    description: '4-liter top-fill ultrasonic cool mist humidifier with auto humidity regulation, essential oil tray, and whisper-quiet operation.',
    brand: 'ComfortAir',
    category_id: '50000000-0000-0000-0000-000000000005',
    specs: { tank_capacity_liters: 4.0, output_ml_hr: 300, coverage_sqft: 400, noise_level_db: 28 }
  },
  {
    product_id: '60000000-0000-0000-0000-000000000040',
    name: 'AuraGlow Smart Sunrise Simulation Bedside Lamp (SAMPLE)',
    description: 'Wake-up light with sunrise simulation, FM radio, 7 natural alarm sounds, dual alarms, and USB phone charging port.',
    brand: 'AuraGlow',
    category_id: '50000000-0000-0000-0000-000000000005',
    specs: { brightness_levels: 20, alarm_sounds: 7, fm_radio: true, sunrise_duration_mins: 30 }
  }
];

// ============================================================================
// 7. DEALER OFFERS
// - Product 1: Exactly 5 offers with exact prompt parameters:
//   Rs.699/4d/3.9/12, Rs.779/1d/4.3/6, Rs.749/2d/4.8/8, Rs.725/2d/4.4/9, Rs.769/3d/4.1/40
//   v7.2: All five stocked at Bangalore warehouse (is_home).
//   Winners:
//   Budget: Rs.699, Fastest: Rs.779, Best Rated: Rs.749, Best Value: Rs.725, Most Available: Rs.769
// - Product 2: Mixed-cart demo product + 1-unit concurrency offer
// - Product 3: Mysuru dealer dual-inventory offer
// - Product 8: Section B offer that exists ONLY at Mysuru with NO Bangalore inventory row
// - Popular products: 2-4 offers each
// ============================================================================

const dealerOffers = [
  // --- PRODUCT 1: Bluetooth Speaker (Exactly 5 Offers - v7.2 Specifications) ---
  {
    offer_id: '70000000-0000-0000-0000-000000000001',
    product_id: '60000000-0000-0000-0000-000000000001',
    dealer_id: '40000000-0000-0000-0000-000000000005', // Jayanagar Value Bazaar (3.9★, 42 reviews)
    purchase_price: 50000,
    selling_price: 69900, // Rs. 699 - BEST BUDGET WINNER (Lowest price)
    status: 'active',
    bangalore_delivery_days: 4,
    transfer_days_min: null,
    transfer_days_max: null,
    eligible_modes: ['standard'],
    warranty_months: 12,
    warranty_note: 'Standard 1-year brand warranty',
    notes: 'WINS BEST BUDGET (Lowest price Rs.699, 4d delivery)'
  },
  {
    offer_id: '70000000-0000-0000-0000-000000000002',
    product_id: '60000000-0000-0000-0000-000000000001',
    dealer_id: '40000000-0000-0000-0000-000000000004', // Whitefield Prime Gadgets (4.3★, 110 reviews)
    purchase_price: 60000,
    selling_price: 77900, // Rs. 779 - FASTEST DELIVERY WINNER (1 day delivery)
    status: 'active',
    bangalore_delivery_days: 1,
    transfer_days_min: null,
    transfer_days_max: null,
    eligible_modes: ['standard'],
    warranty_months: 12,
    warranty_note: 'Express delivery warranty',
    notes: 'WINS FASTEST DELIVERY (1-day delivery at Rs.779)'
  },
  {
    offer_id: '70000000-0000-0000-0000-000000000003',
    product_id: '60000000-0000-0000-0000-000000000001',
    dealer_id: '40000000-0000-0000-0000-000000000001', // Apex Electronics Koramangala (4.8★, 340 reviews)
    purchase_price: 55000,
    selling_price: 74900, // Rs. 749 - BEST RATED DEALER WINNER (Dealer rating 4.8★)
    status: 'active',
    bangalore_delivery_days: 2,
    transfer_days_min: null,
    transfer_days_max: null,
    eligible_modes: ['standard'],
    warranty_months: 24,
    warranty_note: 'Premium 2-year dealer doorstep warranty',
    notes: 'WINS BEST RATED DEALER (Dealer rating 4.8★, 340 reviews)'
  },
  {
    offer_id: '70000000-0000-0000-0000-000000000004',
    product_id: '60000000-0000-0000-0000-000000000001',
    dealer_id: '40000000-0000-0000-0000-000000000003', // Indiranagar Digital Mart (4.4★, 150 reviews)
    purchase_price: 52000,
    selling_price: 72500, // Rs. 725 - BEST VALUE WINNER (Highest composite score: 74.64)
    status: 'active',
    bangalore_delivery_days: 2,
    transfer_days_min: null,
    transfer_days_max: null,
    eligible_modes: ['standard'],
    warranty_months: 18,
    warranty_note: '18-month comprehensive warranty',
    notes: 'WINS BEST VALUE (Score 74.64: optimal balance of price Rs.725, 2d, 4.4★)'
  },
  {
    offer_id: '70000000-0000-0000-0000-000000000005',
    product_id: '60000000-0000-0000-0000-000000000001',
    dealer_id: '40000000-0000-0000-0000-000000000002', // Brigade Tech & Sound (4.1★, 80 reviews)
    purchase_price: 58000,
    selling_price: 76900, // Rs. 769 - MOST AVAILABLE WINNER (40 free units)
    status: 'active',
    bangalore_delivery_days: 3,
    transfer_days_min: null,
    transfer_days_max: null,
    eligible_modes: ['standard'],
    warranty_months: 12,
    warranty_note: 'Standard brand warranty',
    notes: 'WINS MOST AVAILABLE (40 free units in stock)'
  },

  // --- PRODUCT 2: BassMaster Headphones (Mixed-cart demo + 1-unit concurrency offer) ---
  {
    offer_id: '70000000-0000-0000-0000-000000000006',
    product_id: '60000000-0000-0000-0000-000000000002',
    dealer_id: '40000000-0000-0000-0000-000000000001',
    purchase_price: 250000,
    selling_price: 349900, // Rs. 3,499
    status: 'active',
    bangalore_delivery_days: 1,
    transfer_days_min: null,
    transfer_days_max: null,
    eligible_modes: ['standard'],
    warranty_months: 12,
    warranty_note: '1-year manufacturer warranty',
    notes: 'CONCURRENCY TEST TARGET: EXACTLY 1 AVAILABLE UNIT AT BANGALORE WAREHOUSE'
  },
  {
    offer_id: '70000000-0000-0000-0000-000000000007',
    product_id: '60000000-0000-0000-0000-000000000002',
    dealer_id: '40000000-0000-0000-0000-000000000002',
    purchase_price: 270000,
    selling_price: 379900,
    status: 'active',
    bangalore_delivery_days: 2,
    transfer_days_min: null,
    transfer_days_max: null,
    eligible_modes: ['standard'],
    warranty_months: 12,
    warranty_note: '1-year warranty',
    notes: 'MIXED-CART WAREHOUSE OFFER'
  },
  {
    offer_id: '70000000-0000-0000-0000-000000000008',
    product_id: '60000000-0000-0000-0000-000000000002',
    dealer_id: '40000000-0000-0000-0000-000000000003',
    purchase_price: 260000,
    selling_price: 359900,
    status: 'active',
    bangalore_delivery_days: 1,
    transfer_days_min: null,
    transfer_days_max: null,
    eligible_modes: ['quick', 'standard'], // Eligible for quick mode from hub
    warranty_months: 12,
    warranty_note: 'Express local delivery',
    notes: 'MIXED-CART HUB OFFER WITH QUICK ELIGIBILITY'
  },

  // --- PRODUCT 3: SonicAir Bluetooth Earphones (Mysuru Dealer: Dual Inventory) ---
  {
    offer_id: '70000000-0000-0000-0000-000000000009',
    product_id: '60000000-0000-0000-0000-000000000003',
    dealer_id: '40000000-0000-0000-0000-000000000006', // Mysuru Dealer (Chamundi Retail & Audio)
    purchase_price: 110000,
    selling_price: 159900, // Rs. 1,599
    status: 'active',
    bangalore_delivery_days: 1, // Section A: stock at Bangalore warehouse
    transfer_days_min: 2,      // Section B: stock at Mysuru holding
    transfer_days_max: 3,
    eligible_modes: ['standard'],
    warranty_months: 12,
    warranty_note: '1-year dealer warranty',
    notes: 'MYSURU DEALER: HAS STOCK IN BOTH BANGALORE (SECTION A) AND MYSURU (SECTION B); MATCHES BLUETOTH SEARCH'
  },
  {
    offer_id: '70000000-0000-0000-0000-000000000010',
    product_id: '60000000-0000-0000-0000-000000000003',
    dealer_id: '40000000-0000-0000-0000-000000000004',
    purchase_price: 120000,
    selling_price: 169900,
    status: 'active',
    bangalore_delivery_days: 2,
    transfer_days_min: null,
    transfer_days_max: null,
    eligible_modes: ['standard'],
    warranty_months: 12,
    warranty_note: '1-year warranty'
  },

  // --- PRODUCT 4: StudioPro Microphone (2 offers) ---
  {
    offer_id: '70000000-0000-0000-0000-000000000011',
    product_id: '60000000-0000-0000-0000-000000000004',
    dealer_id: '40000000-0000-0000-0000-000000000001',
    purchase_price: 450000,
    selling_price: 599900,
    status: 'active',
    bangalore_delivery_days: 1,
    transfer_days_min: null,
    transfer_days_max: null,
    eligible_modes: ['standard'],
    warranty_months: 24,
    warranty_note: '2-year studio warranty'
  },
  {
    offer_id: '70000000-0000-0000-0000-000000000012',
    product_id: '60000000-0000-0000-0000-000000000004',
    dealer_id: '40000000-0000-0000-0000-000000000002',
    purchase_price: 460000,
    selling_price: 619900,
    status: 'active',
    bangalore_delivery_days: 2,
    transfer_days_min: null,
    transfer_days_max: null,
    eligible_modes: ['standard'],
    warranty_months: 12,
    warranty_note: '1-year warranty'
  },

  // --- PRODUCT 5: Soundbar (2 offers) ---
  {
    offer_id: '70000000-0000-0000-0000-000000000013',
    product_id: '60000000-0000-0000-0000-000000000005',
    dealer_id: '40000000-0000-0000-0000-000000000002',
    purchase_price: 600000,
    selling_price: 799900,
    status: 'active',
    bangalore_delivery_days: 2,
    transfer_days_min: null,
    transfer_days_max: null,
    eligible_modes: ['standard'],
    warranty_months: 12,
    warranty_note: '1-year brand warranty'
  },
  {
    offer_id: '70000000-0000-0000-0000-000000000014',
    product_id: '60000000-0000-0000-0000-000000000005',
    dealer_id: '40000000-0000-0000-0000-000000000005',
    purchase_price: 580000,
    selling_price: 769900,
    status: 'active',
    bangalore_delivery_days: 3,
    transfer_days_min: null,
    transfer_days_max: null,
    eligible_modes: ['standard'],
    warranty_months: 12,
    warranty_note: '1-year brand warranty'
  },

  // --- PRODUCT 6: Conference Speaker (1 offer) ---
  {
    offer_id: '70000000-0000-0000-0000-000000000015',
    product_id: '60000000-0000-0000-0000-000000000006',
    dealer_id: '40000000-0000-0000-0000-000000000003',
    purchase_price: 320000,
    selling_price: 449900,
    status: 'active',
    bangalore_delivery_days: 1,
    transfer_days_min: null,
    transfer_days_max: null,
    eligible_modes: ['quick', 'standard'],
    warranty_months: 12,
    warranty_note: '1-year replacement warranty'
  },

  // --- PRODUCT 7: BeatBox Clip Speaker (2 offers) ---
  {
    offer_id: '70000000-0000-0000-0000-000000000016',
    product_id: '60000000-0000-0000-0000-000000000007',
    dealer_id: '40000000-0000-0000-0000-000000000004',
    purchase_price: 80000,
    selling_price: 119900,
    status: 'active',
    bangalore_delivery_days: 2,
    transfer_days_min: null,
    transfer_days_max: null,
    eligible_modes: ['standard'],
    warranty_months: 6,
    warranty_note: '6-month warranty'
  },
  {
    offer_id: '70000000-0000-0000-0000-000000000017',
    product_id: '60000000-0000-0000-0000-000000000007',
    dealer_id: '40000000-0000-0000-0000-000000000005',
    purchase_price: 75000,
    selling_price: 109900,
    status: 'active',
    bangalore_delivery_days: 3,
    transfer_days_min: null,
    transfer_days_max: null,
    eligible_modes: ['standard'],
    warranty_months: 6,
    warranty_note: '6-month warranty'
  },

  // --- PRODUCT 8: Vintage Turntable (Includes SECTION B ONLY offer) ---
  {
    offer_id: '70000000-0000-0000-0000-000000000018',
    product_id: '60000000-0000-0000-0000-000000000008',
    dealer_id: '40000000-0000-0000-0000-000000000001',
    purchase_price: 850000,
    selling_price: 1149900,
    status: 'active',
    bangalore_delivery_days: 2,
    transfer_days_min: null,
    transfer_days_max: null,
    eligible_modes: ['standard'],
    warranty_months: 12,
    warranty_note: '1-year warranty'
  },
  {
    offer_id: '70000000-0000-0000-0000-000000000019',
    product_id: '60000000-0000-0000-0000-000000000008',
    dealer_id: '40000000-0000-0000-0000-000000000006', // Mysuru dealer
    purchase_price: 820000,
    selling_price: 1099900,
    status: 'active',
    bangalore_delivery_days: null, // NO Bangalore inventory
    transfer_days_min: 2,
    transfer_days_max: 3,
    eligible_modes: ['standard'],
    warranty_months: 12,
    warranty_note: '1-year dealer warranty',
    notes: 'SECTION B ONLY OFFER: EXISTS ONLY AT MYSURU WITH NO BANGALORE INVENTORY ROW'
  },

  // --- PRODUCT 9: PixelGlide Smartphone (Popular - 3 offers) ---
  {
    offer_id: '70000000-0000-0000-0000-000000000020',
    product_id: '60000000-0000-0000-0000-000000000009',
    dealer_id: '40000000-0000-0000-0000-000000000001',
    purchase_price: 2200000,
    selling_price: 2799900,
    status: 'active',
    bangalore_delivery_days: 1,
    transfer_days_min: null,
    transfer_days_max: null,
    eligible_modes: ['quick', 'standard'],
    warranty_months: 12,
    warranty_note: '1-year official brand warranty'
  },
  {
    offer_id: '70000000-0000-0000-0000-000000000021',
    product_id: '60000000-0000-0000-0000-000000000009',
    dealer_id: '40000000-0000-0000-0000-000000000003',
    purchase_price: 2150000,
    selling_price: 2699900,
    status: 'active',
    bangalore_delivery_days: 2,
    transfer_days_min: null,
    transfer_days_max: null,
    eligible_modes: ['standard'],
    warranty_months: 12,
    warranty_note: '1-year brand warranty'
  },
  {
    offer_id: '70000000-0000-0000-0000-000000000022',
    product_id: '60000000-0000-0000-0000-000000000009',
    dealer_id: '40000000-0000-0000-0000-000000000005',
    purchase_price: 2100000,
    selling_price: 2649900,
    status: 'active',
    bangalore_delivery_days: 3,
    transfer_days_min: null,
    transfer_days_max: null,
    eligible_modes: ['standard'],
    warranty_months: 12,
    warranty_note: '1-year brand warranty'
  },

  // --- PRODUCTS 10-16: Mobile accessories ---
  {
    offer_id: '70000000-0000-0000-0000-000000000023',
    product_id: '60000000-0000-0000-0000-000000000010',
    dealer_id: '40000000-0000-0000-0000-000000000002',
    purchase_price: 90000,
    selling_price: 149900,
    status: 'active',
    bangalore_delivery_days: 1,
    transfer_days_min: null,
    transfer_days_max: null,
    eligible_modes: ['quick', 'standard'],
    warranty_months: 12,
    warranty_note: '1-year replacement warranty'
  },
  {
    offer_id: '70000000-0000-0000-0000-000000000024',
    product_id: '60000000-0000-0000-0000-000000000010',
    dealer_id: '40000000-0000-0000-0000-000000000004',
    purchase_price: 85000,
    selling_price: 139900,
    status: 'active',
    bangalore_delivery_days: 2,
    transfer_days_min: null,
    transfer_days_max: null,
    eligible_modes: ['standard'],
    warranty_months: 6,
    warranty_note: '6-month warranty'
  },
  {
    offer_id: '70000000-0000-0000-0000-000000000025',
    product_id: '60000000-0000-0000-0000-000000000011',
    dealer_id: '40000000-0000-0000-0000-000000000003',
    purchase_price: 25000,
    selling_price: 49900,
    status: 'active',
    bangalore_delivery_days: 1,
    transfer_days_min: null,
    transfer_days_max: null,
    eligible_modes: ['quick', 'standard'],
    warranty_months: 3,
    warranty_note: '3-month warranty'
  },
  {
    offer_id: '70000000-0000-0000-0000-000000000026',
    product_id: '60000000-0000-0000-0000-000000000011',
    dealer_id: '40000000-0000-0000-0000-000000000005',
    purchase_price: 20000,
    selling_price: 39900,
    status: 'active',
    bangalore_delivery_days: 3,
    transfer_days_min: null,
    transfer_days_max: null,
    eligible_modes: ['standard'],
    warranty_months: 3,
    warranty_note: '3-month warranty'
  },
  // Power bank (Popular - 3 offers)
  {
    offer_id: '70000000-0000-0000-0000-000000000027',
    product_id: '60000000-0000-0000-0000-000000000012',
    dealer_id: '40000000-0000-0000-0000-000000000001',
    purchase_price: 180000,
    selling_price: 249900,
    status: 'active',
    bangalore_delivery_days: 1,
    transfer_days_min: null,
    transfer_days_max: null,
    eligible_modes: ['quick', 'standard'],
    warranty_months: 12,
    warranty_note: '1-year warranty'
  },
  {
    offer_id: '70000000-0000-0000-0000-000000000028',
    product_id: '60000000-0000-0000-0000-000000000012',
    dealer_id: '40000000-0000-0000-0000-000000000002',
    purchase_price: 175000,
    selling_price: 239900,
    status: 'active',
    bangalore_delivery_days: 2,
    transfer_days_min: null,
    transfer_days_max: null,
    eligible_modes: ['standard'],
    warranty_months: 12,
    warranty_note: '1-year warranty'
  },
  {
    offer_id: '70000000-0000-0000-0000-000000000029',
    product_id: '60000000-0000-0000-0000-000000000012',
    dealer_id: '40000000-0000-0000-0000-000000000004',
    purchase_price: 170000,
    selling_price: 229900,
    status: 'active',
    bangalore_delivery_days: 3,
    transfer_days_min: null,
    transfer_days_max: null,
    eligible_modes: ['standard'],
    warranty_months: 6,
    warranty_note: '6-month warranty'
  },
  {
    offer_id: '70000000-0000-0000-0000-000000000030',
    product_id: '60000000-0000-0000-0000-000000000013',
    dealer_id: '40000000-0000-0000-0000-000000000003',
    purchase_price: 15000,
    selling_price: 29900,
    status: 'active',
    bangalore_delivery_days: 1,
    transfer_days_min: null,
    transfer_days_max: null,
    eligible_modes: ['quick', 'standard'],
    warranty_months: 0,
    warranty_note: null
  },
  {
    offer_id: '70000000-0000-0000-0000-000000000031',
    product_id: '60000000-0000-0000-0000-000000000014',
    dealer_id: '40000000-0000-0000-0000-000000000005',
    purchase_price: 28000,
    selling_price: 49900,
    status: 'active',
    bangalore_delivery_days: 2,
    transfer_days_min: null,
    transfer_days_max: null,
    eligible_modes: ['standard'],
    warranty_months: 6,
    warranty_note: '6-month warranty'
  },
  {
    offer_id: '70000000-0000-0000-0000-000000000032',
    product_id: '60000000-0000-0000-0000-000000000015',
    dealer_id: '40000000-0000-0000-0000-000000000004',
    purchase_price: 35000,
    selling_price: 59900,
    status: 'active',
    bangalore_delivery_days: 2,
    transfer_days_min: null,
    transfer_days_max: null,
    eligible_modes: ['standard'],
    warranty_months: 6,
    warranty_note: '6-month warranty'
  },
  {
    offer_id: '70000000-0000-0000-0000-000000000033',
    product_id: '60000000-0000-0000-0000-000000000016',
    dealer_id: '40000000-0000-0000-0000-000000000002',
    purchase_price: 18000,
    selling_price: 34900,
    status: 'active',
    bangalore_delivery_days: 1,
    transfer_days_min: null,
    transfer_days_max: null,
    eligible_modes: ['quick', 'standard'],
    warranty_months: 6,
    warranty_note: '6-month warranty'
  },

  // --- PRODUCT 17: ApexBook Laptop (Popular - 3 offers) ---
  {
    offer_id: '70000000-0000-0000-0000-000000000034',
    product_id: '60000000-0000-0000-0000-000000000017',
    dealer_id: '40000000-0000-0000-0000-000000000001',
    purchase_price: 4500000,
    selling_price: 5499900,
    status: 'active',
    bangalore_delivery_days: 1,
    transfer_days_min: null,
    transfer_days_max: null,
    eligible_modes: ['standard'],
    warranty_months: 24,
    warranty_note: '2-year onsite warranty'
  },
  {
    offer_id: '70000000-0000-0000-0000-000000000035',
    product_id: '60000000-0000-0000-0000-000000000017',
    dealer_id: '40000000-0000-0000-0000-000000000002',
    purchase_price: 4400000,
    selling_price: 5399900,
    status: 'active',
    bangalore_delivery_days: 2,
    transfer_days_min: null,
    transfer_days_max: null,
    eligible_modes: ['standard'],
    warranty_months: 12,
    warranty_note: '1-year brand warranty'
  },
  {
    offer_id: '70000000-0000-0000-0000-000000000036',
    product_id: '60000000-0000-0000-0000-000000000017',
    dealer_id: '40000000-0000-0000-0000-000000000006', // Mysuru dealer
    purchase_price: 4350000,
    selling_price: 5299900,
    status: 'active',
    bangalore_delivery_days: null,
    transfer_days_min: 2,
    transfer_days_max: 3,
    eligible_modes: ['standard'],
    warranty_months: 12,
    warranty_note: '1-year brand warranty'
  },

  // --- PRODUCTS 18-24: Computers & Peripherals ---
  {
    offer_id: '70000000-0000-0000-0000-000000000037',
    product_id: '60000000-0000-0000-0000-000000000018',
    dealer_id: '40000000-0000-0000-0000-000000000002',
    purchase_price: 280000,
    selling_price: 399900,
    status: 'active',
    bangalore_delivery_days: 1,
    transfer_days_min: null,
    transfer_days_max: null,
    eligible_modes: ['quick', 'standard'],
    warranty_months: 12,
    warranty_note: '1-year warranty'
  },
  {
    offer_id: '70000000-0000-0000-0000-000000000038',
    product_id: '60000000-0000-0000-0000-000000000018',
    dealer_id: '40000000-0000-0000-0000-000000000004',
    purchase_price: 270000,
    selling_price: 379900,
    status: 'active',
    bangalore_delivery_days: 2,
    transfer_days_min: null,
    transfer_days_max: null,
    eligible_modes: ['standard'],
    warranty_months: 12,
    warranty_note: '1-year warranty'
  },
  {
    offer_id: '70000000-0000-0000-0000-000000000039',
    product_id: '60000000-0000-0000-0000-000000000019',
    dealer_id: '40000000-0000-0000-0000-000000000003',
    purchase_price: 120000,
    selling_price: 189900,
    status: 'active',
    bangalore_delivery_days: 1,
    transfer_days_min: null,
    transfer_days_max: null,
    eligible_modes: ['quick', 'standard'],
    warranty_months: 12,
    warranty_note: '1-year warranty'
  },
  {
    offer_id: '70000000-0000-0000-0000-000000000040',
    product_id: '60000000-0000-0000-0000-000000000019',
    dealer_id: '40000000-0000-0000-0000-000000000005',
    purchase_price: 110000,
    selling_price: 174900,
    status: 'active',
    bangalore_delivery_days: 3,
    transfer_days_min: null,
    transfer_days_max: null,
    eligible_modes: ['standard'],
    warranty_months: 12,
    warranty_note: '1-year warranty'
  },
  {
    offer_id: '70000000-0000-0000-0000-000000000041',
    product_id: '60000000-0000-0000-0000-000000000020',
    dealer_id: '40000000-0000-0000-0000-000000000001',
    purchase_price: 1800000,
    selling_price: 2399900,
    status: 'active',
    bangalore_delivery_days: 1,
    transfer_days_min: null,
    transfer_days_max: null,
    eligible_modes: ['standard'],
    warranty_months: 36,
    warranty_note: '3-year panel warranty'
  },
  {
    offer_id: '70000000-0000-0000-0000-000000000042',
    product_id: '60000000-0000-0000-0000-000000000020',
    dealer_id: '40000000-0000-0000-0000-000000000002',
    purchase_price: 1750000,
    selling_price: 2299900,
    status: 'active',
    bangalore_delivery_days: 2,
    transfer_days_min: null,
    transfer_days_max: null,
    eligible_modes: ['standard'],
    warranty_months: 36,
    warranty_note: '3-year panel warranty'
  },
  {
    offer_id: '70000000-0000-0000-0000-000000000043',
    product_id: '60000000-0000-0000-0000-000000000021',
    dealer_id: '40000000-0000-0000-0000-000000000004',
    purchase_price: 220000,
    selling_price: 329900,
    status: 'active',
    bangalore_delivery_days: 2,
    transfer_days_min: null,
    transfer_days_max: null,
    eligible_modes: ['standard'],
    warranty_months: 12,
    warranty_note: '1-year warranty'
  },
  {
    offer_id: '70000000-0000-0000-0000-000000000044',
    product_id: '60000000-0000-0000-0000-000000000022',
    dealer_id: '40000000-0000-0000-0000-000000000003',
    purchase_price: 280000,
    selling_price: 399900,
    status: 'active',
    bangalore_delivery_days: 1,
    transfer_days_min: null,
    transfer_days_max: null,
    eligible_modes: ['quick', 'standard'],
    warranty_months: 12,
    warranty_note: '1-year warranty'
  },
  {
    offer_id: '70000000-0000-0000-0000-000000000045',
    product_id: '60000000-0000-0000-0000-000000000023',
    dealer_id: '40000000-0000-0000-0000-000000000001',
    purchase_price: 520000,
    selling_price: 699900,
    status: 'active',
    bangalore_delivery_days: 1,
    transfer_days_min: null,
    transfer_days_max: null,
    eligible_modes: ['quick', 'standard'],
    warranty_months: 36,
    warranty_note: '3-year limited warranty'
  },
  {
    offer_id: '70000000-0000-0000-0000-000000000046',
    product_id: '60000000-0000-0000-0000-000000000024',
    dealer_id: '40000000-0000-0000-0000-000000000005',
    purchase_price: 80000,
    selling_price: 129900,
    status: 'active',
    bangalore_delivery_days: 2,
    transfer_days_min: null,
    transfer_days_max: null,
    eligible_modes: ['standard'],
    warranty_months: 12,
    warranty_note: '1-year warranty'
  },

  // --- PRODUCT 25: 4K Mirrorless Camera (Popular - 3 offers) ---
  {
    offer_id: '70000000-0000-0000-0000-000000000047',
    product_id: '60000000-0000-0000-0000-000000000025',
    dealer_id: '40000000-0000-0000-0000-000000000001',
    purchase_price: 8500000,
    selling_price: 10499900,
    status: 'active',
    bangalore_delivery_days: 1,
    transfer_days_min: null,
    transfer_days_max: null,
    eligible_modes: ['standard'],
    warranty_months: 24,
    warranty_note: '2-year official sensor warranty'
  },
  {
    offer_id: '70000000-0000-0000-0000-000000000048',
    product_id: '60000000-0000-0000-0000-000000000025',
    dealer_id: '40000000-0000-0000-0000-000000000002',
    purchase_price: 8400000,
    selling_price: 10299900,
    status: 'active',
    bangalore_delivery_days: 2,
    transfer_days_min: null,
    transfer_days_max: null,
    eligible_modes: ['standard'],
    warranty_months: 24,
    warranty_note: '2-year brand warranty'
  },
  {
    offer_id: '70000000-0000-0000-0000-000000000049',
    product_id: '60000000-0000-0000-0000-000000000025',
    dealer_id: '40000000-0000-0000-0000-000000000006', // Mysuru dealer
    purchase_price: 8300000,
    selling_price: 10199900,
    status: 'active',
    bangalore_delivery_days: null,
    transfer_days_min: 2,
    transfer_days_max: 3,
    eligible_modes: ['standard'],
    warranty_months: 24,
    warranty_note: '2-year brand warranty'
  },

  // --- PRODUCTS 26-32: Camera Gear ---
  {
    offer_id: '70000000-0000-0000-0000-000000000050',
    product_id: '60000000-0000-0000-0000-000000000026',
    dealer_id: '40000000-0000-0000-0000-000000000003',
    purchase_price: 1900000,
    selling_price: 2499900,
    status: 'active',
    bangalore_delivery_days: 1,
    transfer_days_min: null,
    transfer_days_max: null,
    eligible_modes: ['quick', 'standard'],
    warranty_months: 12,
    warranty_note: '1-year warranty'
  },
  {
    offer_id: '70000000-0000-0000-0000-000000000051',
    product_id: '60000000-0000-0000-0000-000000000026',
    dealer_id: '40000000-0000-0000-0000-000000000004',
    purchase_price: 1850000,
    selling_price: 2399900,
    status: 'active',
    bangalore_delivery_days: 2,
    transfer_days_min: null,
    transfer_days_max: null,
    eligible_modes: ['standard'],
    warranty_months: 12,
    warranty_note: '1-year warranty'
  },
  {
    offer_id: '70000000-0000-0000-0000-000000000052',
    product_id: '60000000-0000-0000-0000-000000000027',
    dealer_id: '40000000-0000-0000-0000-000000000002',
    purchase_price: 650000,
    selling_price: 899900,
    status: 'active',
    bangalore_delivery_days: 1,
    transfer_days_min: null,
    transfer_days_max: null,
    eligible_modes: ['quick', 'standard'],
    warranty_months: 12,
    warranty_note: '1-year warranty'
  },
  {
    offer_id: '70000000-0000-0000-0000-000000000053',
    product_id: '60000000-0000-0000-0000-000000000027',
    dealer_id: '40000000-0000-0000-0000-000000000005',
    purchase_price: 620000,
    selling_price: 849900,
    status: 'active',
    bangalore_delivery_days: 3,
    transfer_days_min: null,
    transfer_days_max: null,
    eligible_modes: ['standard'],
    warranty_months: 12,
    warranty_note: '1-year warranty'
  },
  {
    offer_id: '70000000-0000-0000-0000-000000000054',
    product_id: '60000000-0000-0000-0000-000000000028',
    dealer_id: '40000000-0000-0000-0000-000000000004',
    purchase_price: 180000,
    selling_price: 279900,
    status: 'active',
    bangalore_delivery_days: 2,
    transfer_days_min: null,
    transfer_days_max: null,
    eligible_modes: ['standard'],
    warranty_months: 6,
    warranty_note: '6-month warranty'
  },
  {
    offer_id: '70000000-0000-0000-0000-000000000055',
    product_id: '60000000-0000-0000-0000-000000000029',
    dealer_id: '40000000-0000-0000-0000-000000000001',
    purchase_price: 550000,
    selling_price: 799900,
    status: 'active',
    bangalore_delivery_days: 1,
    transfer_days_min: null,
    transfer_days_max: null,
    eligible_modes: ['standard'],
    warranty_months: 24,
    warranty_note: '2-year warranty'
  },
  {
    offer_id: '70000000-0000-0000-0000-000000000056',
    product_id: '60000000-0000-0000-0000-000000000030',
    dealer_id: '40000000-0000-0000-0000-000000000002',
    purchase_price: 800000,
    selling_price: 1149900,
    status: 'active',
    bangalore_delivery_days: 2,
    transfer_days_min: null,
    transfer_days_max: null,
    eligible_modes: ['standard'],
    warranty_months: 24,
    warranty_note: '2-year brand warranty'
  },
  {
    offer_id: '70000000-0000-0000-0000-000000000057',
    product_id: '60000000-0000-0000-0000-000000000031',
    dealer_id: '40000000-0000-0000-0000-000000000003',
    purchase_price: 350000,
    selling_price: 499900,
    status: 'active',
    bangalore_delivery_days: 1,
    transfer_days_min: null,
    transfer_days_max: null,
    eligible_modes: ['quick', 'standard'],
    warranty_months: 60,
    warranty_note: '5-year manufacturer warranty'
  },
  {
    offer_id: '70000000-0000-0000-0000-000000000058',
    product_id: '60000000-0000-0000-0000-000000000032',
    dealer_id: '40000000-0000-0000-0000-000000000001',
    purchase_price: 2800000,
    selling_price: 3699900,
    status: 'active',
    bangalore_delivery_days: 1,
    transfer_days_min: null,
    transfer_days_max: null,
    eligible_modes: ['standard'],
    warranty_months: 12,
    warranty_note: '1-year warranty'
  },

  // --- PRODUCT 33: Fitness Smartwatch (Popular - 3 offers) ---
  {
    offer_id: '70000000-0000-0000-0000-000000000059',
    product_id: '60000000-0000-0000-0000-000000000033',
    dealer_id: '40000000-0000-0000-0000-000000000001',
    purchase_price: 320000,
    selling_price: 449900,
    status: 'active',
    bangalore_delivery_days: 1,
    transfer_days_min: null,
    transfer_days_max: null,
    eligible_modes: ['quick', 'standard'],
    warranty_months: 12,
    warranty_note: '1-year brand warranty'
  },
  {
    offer_id: '70000000-0000-0000-0000-000000000060',
    product_id: '60000000-0000-0000-0000-000000000033',
    dealer_id: '40000000-0000-0000-0000-000000000003',
    purchase_price: 310000,
    selling_price: 429900,
    status: 'active',
    bangalore_delivery_days: 2,
    transfer_days_min: null,
    transfer_days_max: null,
    eligible_modes: ['standard'],
    warranty_months: 12,
    warranty_note: '1-year brand warranty'
  },
  {
    offer_id: '70000000-0000-0000-0000-000000000061',
    product_id: '60000000-0000-0000-0000-000000000033',
    dealer_id: '40000000-0000-0000-0000-000000000005',
    purchase_price: 300000,
    selling_price: 419900,
    status: 'active',
    bangalore_delivery_days: 3,
    transfer_days_min: null,
    transfer_days_max: null,
    eligible_modes: ['standard'],
    warranty_months: 12,
    warranty_note: '1-year brand warranty'
  },

  // --- PRODUCTS 34-40: Wearables & Smart Home ---
  {
    offer_id: '70000000-0000-0000-0000-000000000062',
    product_id: '60000000-0000-0000-0000-000000000034',
    dealer_id: '40000000-0000-0000-0000-000000000002',
    purchase_price: 140000,
    selling_price: 199900,
    status: 'active',
    bangalore_delivery_days: 1,
    transfer_days_min: null,
    transfer_days_max: null,
    eligible_modes: ['quick', 'standard'],
    warranty_months: 12,
    warranty_note: '1-year warranty'
  },
  {
    offer_id: '70000000-0000-0000-0000-000000000063',
    product_id: '60000000-0000-0000-0000-000000000034',
    dealer_id: '40000000-0000-0000-0000-000000000004',
    purchase_price: 135000,
    selling_price: 189900,
    status: 'active',
    bangalore_delivery_days: 2,
    transfer_days_min: null,
    transfer_days_max: null,
    eligible_modes: ['standard'],
    warranty_months: 12,
    warranty_note: '1-year warranty'
  },
  {
    offer_id: '70000000-0000-0000-0000-000000000064',
    product_id: '60000000-0000-0000-0000-000000000035',
    dealer_id: '40000000-0000-0000-0000-000000000003',
    purchase_price: 32000,
    selling_price: 59900,
    status: 'active',
    bangalore_delivery_days: 1,
    transfer_days_min: null,
    transfer_days_max: null,
    eligible_modes: ['quick', 'standard'],
    warranty_months: 12,
    warranty_note: '1-year warranty'
  },
  {
    offer_id: '70000000-0000-0000-0000-000000000065',
    product_id: '60000000-0000-0000-0000-000000000035',
    dealer_id: '40000000-0000-0000-0000-000000000005',
    purchase_price: 30000,
    selling_price: 54900,
    status: 'active',
    bangalore_delivery_days: 2,
    transfer_days_min: null,
    transfer_days_max: null,
    eligible_modes: ['standard'],
    warranty_months: 12,
    warranty_note: '1-year warranty'
  },
  {
    offer_id: '70000000-0000-0000-0000-000000000066',
    product_id: '60000000-0000-0000-0000-000000000036',
    dealer_id: '40000000-0000-0000-0000-000000000001',
    purchase_price: 420000,
    selling_price: 599900,
    status: 'active',
    bangalore_delivery_days: 1,
    transfer_days_min: null,
    transfer_days_max: null,
    eligible_modes: ['standard'],
    warranty_months: 12,
    warranty_note: '1-year warranty'
  },
  {
    offer_id: '70000000-0000-0000-0000-000000000067',
    product_id: '60000000-0000-0000-0000-000000000036',
    dealer_id: '40000000-0000-0000-0000-000000000002',
    purchase_price: 410000,
    selling_price: 579900,
    status: 'active',
    bangalore_delivery_days: 2,
    transfer_days_min: null,
    transfer_days_max: null,
    eligible_modes: ['standard'],
    warranty_months: 12,
    warranty_note: '1-year warranty'
  },
  {
    offer_id: '70000000-0000-0000-0000-000000000068',
    product_id: '60000000-0000-0000-0000-000000000037',
    dealer_id: '40000000-0000-0000-0000-000000000004',
    purchase_price: 55000,
    selling_price: 89900,
    status: 'active',
    bangalore_delivery_days: 1,
    transfer_days_min: null,
    transfer_days_max: null,
    eligible_modes: ['quick', 'standard'],
    warranty_months: 12,
    warranty_note: '1-year warranty'
  },
  {
    offer_id: '70000000-0000-0000-0000-000000000069',
    product_id: '60000000-0000-0000-0000-000000000037',
    dealer_id: '40000000-0000-0000-0000-000000000005',
    purchase_price: 50000,
    selling_price: 79900,
    status: 'active',
    bangalore_delivery_days: 2,
    transfer_days_min: null,
    transfer_days_max: null,
    eligible_modes: ['standard'],
    warranty_months: 12,
    warranty_note: '1-year warranty'
  },
  {
    offer_id: '70000000-0000-0000-0000-000000000070',
    product_id: '60000000-0000-0000-0000-000000000038',
    dealer_id: '40000000-0000-0000-0000-000000000001',
    purchase_price: 1800000,
    selling_price: 2499900,
    status: 'active',
    bangalore_delivery_days: 1,
    transfer_days_min: null,
    transfer_days_max: null,
    eligible_modes: ['standard'],
    warranty_months: 12,
    warranty_note: '1-year motor warranty'
  },
  {
    offer_id: '70000000-0000-0000-0000-000000000071',
    product_id: '60000000-0000-0000-0000-000000000038',
    dealer_id: '40000000-0000-0000-0000-000000000006', // Mysuru dealer
    purchase_price: 1750000,
    selling_price: 2399900,
    status: 'active',
    bangalore_delivery_days: null,
    transfer_days_min: 2,
    transfer_days_max: 3,
    eligible_modes: ['standard'],
    warranty_months: 12,
    warranty_note: '1-year warranty'
  },
  {
    offer_id: '70000000-0000-0000-0000-000000000072',
    product_id: '60000000-0000-0000-0000-000000000039',
    dealer_id: '40000000-0000-0000-0000-000000000003',
    purchase_price: 140000,
    selling_price: 219900,
    status: 'active',
    bangalore_delivery_days: 1,
    transfer_days_min: null,
    transfer_days_max: null,
    eligible_modes: ['quick', 'standard'],
    warranty_months: 12,
    warranty_note: '1-year warranty'
  },
  {
    offer_id: '70000000-0000-0000-0000-000000000073',
    product_id: '60000000-0000-0000-0000-000000000039',
    dealer_id: '40000000-0000-0000-0000-000000000004',
    purchase_price: 135000,
    selling_price: 209900,
    status: 'active',
    bangalore_delivery_days: 2,
    transfer_days_min: null,
    transfer_days_max: null,
    eligible_modes: ['standard'],
    warranty_months: 12,
    warranty_note: '1-year warranty'
  },
  {
    offer_id: '70000000-0000-0000-0000-000000000074',
    product_id: '60000000-0000-0000-0000-000000000040',
    dealer_id: '40000000-0000-0000-0000-000000000002',
    purchase_price: 160000,
    selling_price: 249900,
    status: 'active',
    bangalore_delivery_days: 1,
    transfer_days_min: null,
    transfer_days_max: null,
    eligible_modes: ['quick', 'standard'],
    warranty_months: 12,
    warranty_note: '1-year warranty'
  },
  {
    offer_id: '70000000-0000-0000-0000-000000000075',
    product_id: '60000000-0000-0000-0000-000000000040',
    dealer_id: '40000000-0000-0000-0000-000000000005',
    purchase_price: 150000,
    selling_price: 234900,
    status: 'active',
    bangalore_delivery_days: 2,
    transfer_days_min: null,
    transfer_days_max: null,
    eligible_modes: ['standard'],
    warranty_months: 12,
    warranty_note: '1-year warranty'
  }
];

// ============================================================================
// 8. INVENTORY RECORDS
// Locations:
// 10000000-0000-0000-0000-000000000001: Bangalore Central Warehouse (warehouse, is_home=true)
// 10000000-0000-0000-0000-000000000002: Bangalore Express Hub (hub, sellable)
// 10000000-0000-0000-0000-000000000003: Bangalore Quarantine Facility (quarantine, NOT sellable)
// 10000000-0000-0000-0000-000000000004: Mysuru Regional Holding (holding, sellable)
// ============================================================================
const inventory = [
  // --- Bluetooth Speaker (Product 1, Offers 1-5): All 5 stocked at Bangalore Warehouse (is_home) ---
  // Offer 1 (Budget Rs.699): 12 units (between 5 and 20)
  {
    inventory_id: '80000000-0000-0000-0000-000000000001',
    offer_id: '70000000-0000-0000-0000-000000000001',
    location_id: '10000000-0000-0000-0000-000000000001',
    quantity: 12,
    reserved_quantity: 0
  },
  // Offer 2 (Fastest Rs.779): 6 units (between 5 and 20)
  {
    inventory_id: '80000000-0000-0000-0000-000000000002',
    offer_id: '70000000-0000-0000-0000-000000000002',
    location_id: '10000000-0000-0000-0000-000000000001',
    quantity: 6,
    reserved_quantity: 0
  },
  // Offer 3 (Best Rated Rs.749): 8 units (between 5 and 20)
  {
    inventory_id: '80000000-0000-0000-0000-000000000003',
    offer_id: '70000000-0000-0000-0000-000000000003',
    location_id: '10000000-0000-0000-0000-000000000001',
    quantity: 8,
    reserved_quantity: 0
  },
  // Offer 4 (Best Value Rs.725): 9 units (between 5 and 20)
  {
    inventory_id: '80000000-0000-0000-0000-000000000004',
    offer_id: '70000000-0000-0000-0000-000000000004',
    location_id: '10000000-0000-0000-0000-000000000001',
    quantity: 9,
    reserved_quantity: 0
  },
  // Offer 5 (Most Available Rs.769): Exactly 40 units at Bangalore Warehouse
  {
    inventory_id: '80000000-0000-0000-0000-000000000005',
    offer_id: '70000000-0000-0000-0000-000000000005',
    location_id: '10000000-0000-0000-0000-000000000001',
    quantity: 40,
    reserved_quantity: 0
  },

  // --- PRODUCT 2: Mixed-cart demo product + Concurrency Test Offer ---
  // Offer 6: Concurrency test target (EXACTLY 1 AVAILABLE UNIT at Bangalore warehouse)
  {
    inventory_id: '80000000-0000-0000-0000-000000000006',
    offer_id: '70000000-0000-0000-0000-000000000006',
    location_id: '10000000-0000-0000-0000-000000000001',
    quantity: 1,
    reserved_quantity: 0
  },
  // Offer 7: Mixed-cart warehouse stock (Bangalore warehouse)
  {
    inventory_id: '80000000-0000-0000-0000-000000000007',
    offer_id: '70000000-0000-0000-0000-000000000007',
    location_id: '10000000-0000-0000-0000-000000000001',
    quantity: 25,
    reserved_quantity: 0
  },
  // Offer 8: Mixed-cart Hub stock (Bangalore Express Hub) with quick delivery
  {
    inventory_id: '80000000-0000-0000-0000-000000000008',
    offer_id: '70000000-0000-0000-0000-000000000008',
    location_id: '10000000-0000-0000-0000-000000000002',
    quantity: 15,
    reserved_quantity: 0
  },

  // --- PRODUCT 3: Mysuru dealer with inventory in both Mysuru and Bangalore ---
  // Offer 9: Stock in Bangalore Central Warehouse (Section A)
  {
    inventory_id: '80000000-0000-0000-0000-000000000009',
    offer_id: '70000000-0000-0000-0000-000000000009',
    location_id: '10000000-0000-0000-0000-000000000001',
    quantity: 15,
    reserved_quantity: 0
  },
  // Offer 9: Stock in Mysuru Regional Holding (Section B)
  {
    inventory_id: '80000000-0000-0000-0000-000000000010',
    offer_id: '70000000-0000-0000-0000-000000000009',
    location_id: '10000000-0000-0000-0000-000000000004',
    quantity: 25,
    reserved_quantity: 0
  },
  // Offer 10: Bangalore warehouse
  {
    inventory_id: '80000000-0000-0000-0000-000000000011',
    offer_id: '70000000-0000-0000-0000-000000000010',
    location_id: '10000000-0000-0000-0000-000000000001',
    quantity: 30,
    reserved_quantity: 0
  },

  // --- PRODUCT 8: Offer 19: Section B offer that exists ONLY at Mysuru with NO Bangalore inventory row ---
  {
    inventory_id: '80000000-0000-0000-0000-000000000012',
    offer_id: '70000000-0000-0000-0000-000000000019',
    location_id: '10000000-0000-0000-0000-000000000004', // Mysuru holding ONLY
    quantity: 10,
    reserved_quantity: 0
  },

  // --- Quarantine location stock (Location 3, NOT sellable) ---
  {
    inventory_id: '80000000-0000-0000-0000-000000000013',
    offer_id: '70000000-0000-0000-0000-000000000005',
    location_id: '10000000-0000-0000-0000-000000000003',
    quantity: 5,
    reserved_quantity: 0
  },

  // --- Offers 11 through 18, and 20 through 75 ---
  ...dealerOffers
    .filter(o => !['70000000-0000-0000-0000-000000000001', '70000000-0000-0000-0000-000000000002', '70000000-0000-0000-0000-000000000003', '70000000-0000-0000-0000-000000000004', '70000000-0000-0000-0000-000000000005', '70000000-0000-0000-0000-000000000006', '70000000-0000-0000-0000-000000000007', '70000000-0000-0000-0000-000000000008', '70000000-0000-0000-0000-000000000009', '70000000-0000-0000-0000-000000000010', '70000000-0000-0000-0000-000000000019'].includes(o.offer_id))
    .map((offer, index) => {
      const locId = offer.dealer_id === '40000000-0000-0000-0000-000000000006'
        ? '10000000-0000-0000-0000-000000000004' // Mysuru holding
        : (offer.eligible_modes.includes('quick')
            ? '10000000-0000-0000-0000-000000000002' // Bangalore Hub
            : '10000000-0000-0000-0000-000000000001'); // Bangalore Warehouse

      const qty = 15 + ((index * 7) % 35);
      return {
        inventory_id: `80000000-0000-0000-0000-${String(index + 14).padStart(12, '0')}`,
        offer_id: offer.offer_id,
        location_id: locId,
        quantity: qty,
        reserved_quantity: 0
      };
    })
];

// ============================================================================
// 9. SAMPLE PRICE HISTORY
// - Commented as sample data, not market data
// - v7.2: Triggers opened current rows; these old rows are inserted closed
//   (valid_from = now()-20d, valid_to = now()-1d, higher price)
// ============================================================================
const historicalPrices = [
  // SAMPLE: Offer 1 (Bluetooth speaker - Budget Rs.699): was previously Rs.899
  {
    offer_id: '70000000-0000-0000-0000-000000000001',
    selling_price: 89900,
    valid_from_offset_days: 20,
    valid_to_offset_days: 1
  },
  // SAMPLE: Offer 4 (Bluetooth speaker - Value Rs.725): was previously Rs.799
  {
    offer_id: '70000000-0000-0000-0000-000000000004',
    selling_price: 79900,
    valid_from_offset_days: 20,
    valid_to_offset_days: 1
  },
  // SAMPLE: Offer 6 (BassMaster Headphones - Last unit Rs.3499): was previously Rs.3999
  {
    offer_id: '70000000-0000-0000-0000-000000000006',
    selling_price: 399900,
    valid_from_offset_days: 20,
    valid_to_offset_days: 1
  },
  // SAMPLE: Offer 20 (PixelGlide 5G Rs.27999): was previously Rs.29999
  {
    offer_id: '70000000-0000-0000-0000-000000000020',
    selling_price: 2999900,
    valid_from_offset_days: 20,
    valid_to_offset_days: 1
  },
  // SAMPLE: Offer 34 (ApexBook Laptop Rs.54999): was previously Rs.59999
  {
    offer_id: '70000000-0000-0000-0000-000000000034',
    selling_price: 5999900,
    valid_from_offset_days: 20,
    valid_to_offset_days: 1
  }
];

// ============================================================================
// 10. COUPONS
// - Single redemption coupon: max_redemptions=1, per_customer_limit=1
// - Per-customer coupon: max_redemptions=100, per_customer_limit=1
// - Normal coupon: max_redemptions=NULL, per_customer_limit=5
// ============================================================================
const coupons = [
  {
    coupon_id: '90000000-0000-0000-0000-000000000001',
    code: 'SINGLE10',
    kind: 'percent',
    value: 10, // 10%
    min_basket_paise: 49900, // Min Rs. 499
    max_redemptions: 1, // Single redemption limit test
    redeemed_count: 0,
    per_customer_limit: 1,
    valid_from_offset_days: -10,
    valid_to_offset_days: 60,
    active: true
  },
  {
    coupon_id: '90000000-0000-0000-0000-000000000002',
    code: 'PERCUST1',
    kind: 'fixed_paise',
    value: 5000, // Flat Rs. 50
    min_basket_paise: 49900,
    max_redemptions: 100,
    redeemed_count: 0,
    per_customer_limit: 1, // Per customer limit test
    valid_from_offset_days: -10,
    valid_to_offset_days: 60,
    active: true
  },
  {
    coupon_id: '90000000-0000-0000-0000-000000000003',
    code: 'SAVE10',
    kind: 'percent',
    value: 10,
    min_basket_paise: 99900,
    max_redemptions: null, // Normal coupon without global redemption cap
    redeemed_count: 0,
    per_customer_limit: 5,
    valid_from_offset_days: -10,
    valid_to_offset_days: 90,
    active: true
  }
];

module.exports = {
  BCRYPT_HASHES,
  stockLocations,
  fulfilmentHubs,
  hubServiceAreas,
  getUsers,
  carts,
  dealers,
  categories,
  products,
  dealerOffers,
  inventory,
  historicalPrices,
  coupons
};
