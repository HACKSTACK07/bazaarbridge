--
-- BazaarBridge Database Seed Script (SAMPLE DATA)
-- Authoritative seed for Version 7.2 Frozen Schema
-- Idempotent: safe to run multiple times without duplicate records or errors
--
BEGIN;

-- 1. Stock Locations (Bangalore Warehouse, Bangalore Hub, Quarantine, Mysuru Holding)
INSERT INTO stock_locations (location_id, name, city, state, location_type, is_home, is_sellable)
VALUES
  ('10000000-0000-0000-0000-000000000001', 'Bangalore Central Warehouse (SAMPLE)', 'Bangalore', 'Karnataka', 'warehouse', true, true),
  ('10000000-0000-0000-0000-000000000002', 'Bangalore Express Hub (SAMPLE)', 'Bangalore', 'Karnataka', 'hub', false, true),
  ('10000000-0000-0000-0000-000000000003', 'Bangalore Quarantine Facility (SAMPLE)', 'Bangalore', 'Karnataka', 'quarantine', false, false),
  ('10000000-0000-0000-0000-000000000004', 'Mysuru Regional Holding (SAMPLE)', 'Mysuru', 'Karnataka', 'holding', false, true)
ON CONFLICT (location_id) DO UPDATE SET
  name = EXCLUDED.name,
  city = EXCLUDED.city,
  state = EXCLUDED.state,
  location_type = EXCLUDED.location_type,
  is_home = EXCLUDED.is_home,
  is_sellable = EXCLUDED.is_sellable;

-- 2. Fulfilment Hubs (Bangalore Express Hub)
INSERT INTO fulfilment_hubs (hub_id, location_id, address, hours, active, order_capacity, delivery_radius_km)
VALUES
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000002', '100 Feet Road, HAL 2nd Stage, Indiranagar, Bangalore, Karnataka (SAMPLE)', '{"open":"08:00","close":"22:00","timezone":"Asia/Kolkata","days":["Mon","Tue","Wed","Thu","Fri","Sat","Sun"]}'::jsonb, true, 50, 12.5)
ON CONFLICT (location_id) DO UPDATE SET
  address = EXCLUDED.address,
  hours = EXCLUDED.hours,
  active = EXCLUDED.active,
  order_capacity = EXCLUDED.order_capacity,
  delivery_radius_km = EXCLUDED.delivery_radius_km;

-- 3. Hub Service Areas (3 PIN codes: 560001, 560038, 560025)
INSERT INTO hub_service_areas (area_id, hub_id, pin_code)
VALUES
  ('21000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '560001'),
  ('21000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000001', '560038'),
  ('21000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-000000000001', '560025')
ON CONFLICT (pin_code) DO UPDATE SET
  hub_id = EXCLUDED.hub_id;

-- 4. Demo Users (Customer, Admin, Rider with bcrypt hashes)
INSERT INTO users (user_id, name, email, password_hash, role)
VALUES
  ('30000000-0000-0000-0000-000000000001', 'Demo Customer (SAMPLE)', 'demo@bazaarbridge.dev', '$2b$10$nd//QBHpeqbCZwi4d51QRe/L2vqStvl8JMIuDx/CRoG6Dh6EwdHqK', 'customer'),
  ('30000000-0000-0000-0000-000000000002', 'System Admin (SAMPLE)', 'admin@bazaarbridge.dev', '$2b$10$9lVaOKWOBDRSfreCyD9jf.wLOHABykUM0Wl5l2rO9XGEGM2TsE216', 'admin'),
  ('30000000-0000-0000-0000-000000000003', 'Express Rider Ramesh (SAMPLE)', 'rider@bazaarbridge.dev', '$2b$10$KDu1mFsxWZYbj3ZeCuWX6O5p4NiMAFkrCXTFCekiKDRF4hnKVFykq', 'rider')
ON CONFLICT (email) DO UPDATE SET
  name = EXCLUDED.name,
  password_hash = EXCLUDED.password_hash,
  role = EXCLUDED.role;

-- 5. User Carts
INSERT INTO carts (cart_id, user_id)
VALUES
  ('35000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001'),
  ('35000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000002'),
  ('35000000-0000-0000-0000-000000000003', '30000000-0000-0000-0000-000000000003')
ON CONFLICT (user_id) DO NOTHING;

-- 6. Dealers (5 Bangalore Dealers with distinct ratings/reviews + 1 Mysuru Dealer)
INSERT INTO dealers (dealer_id, shop_name, city, state, contact, dealer_rating, total_reviews, verified, supplier_status)
VALUES
  ('40000000-0000-0000-0000-000000000001', 'Apex Electronics Koramangala (SAMPLE)', 'Bangalore', 'Karnataka', '+91 98450 11001', 4.8, 340, true, 'active'),
  ('40000000-0000-0000-0000-000000000002', 'Brigade Tech & Sound (SAMPLE)', 'Bangalore', 'Karnataka', '+91 98450 22002', 4.1, 80, true, 'active'),
  ('40000000-0000-0000-0000-000000000003', 'Indiranagar Digital Mart (SAMPLE)', 'Bangalore', 'Karnataka', '+91 98450 33003', 4.4, 150, true, 'active'),
  ('40000000-0000-0000-0000-000000000004', 'Whitefield Prime Gadgets (SAMPLE)', 'Bangalore', 'Karnataka', '+91 98450 44004', 4.3, 110, false, 'active'),
  ('40000000-0000-0000-0000-000000000005', 'Jayanagar Value Bazaar (SAMPLE)', 'Bangalore', 'Karnataka', '+91 98450 55005', 3.9, 42, true, 'active'),
  ('40000000-0000-0000-0000-000000000006', 'Chamundi Retail & Audio (SAMPLE)', 'Mysuru', 'Karnataka', '+91 821 2400006', 4.5, 96, true, 'active')
ON CONFLICT (dealer_id) DO UPDATE SET
  shop_name = EXCLUDED.shop_name,
  city = EXCLUDED.city,
  state = EXCLUDED.state,
  contact = EXCLUDED.contact,
  dealer_rating = EXCLUDED.dealer_rating,
  total_reviews = EXCLUDED.total_reviews,
  verified = EXCLUDED.verified,
  supplier_status = EXCLUDED.supplier_status;

-- 7. Product Categories (5 Categories)
INSERT INTO categories (category_id, category_name)
VALUES
  ('50000000-0000-0000-0000-000000000001', 'Audio & Headphones'),
  ('50000000-0000-0000-0000-000000000002', 'Mobiles & Accessories'),
  ('50000000-0000-0000-0000-000000000003', 'Computers & Peripherals'),
  ('50000000-0000-0000-0000-000000000004', 'Cameras & Photography'),
  ('50000000-0000-0000-0000-000000000005', 'Wearables & Smart Home')
ON CONFLICT (category_name) DO NOTHING;

-- 8. Products (40 Products across 5 Categories; Product 1 is Bluetooth Speaker)
INSERT INTO products (product_id, name, description, brand, category_id, specs)
VALUES
  ('60000000-0000-0000-0000-000000000001', 'EchoPulse Boom 360 Portable Bluetooth Speaker (SAMPLE)', 'Rugged waterproof Bluetooth 5.3 portable speaker with 360-degree sound, 24-hour battery life, and IPX7 rating.', 'EchoPulse', '50000000-0000-0000-0000-000000000001', '{"power_watts":20,"battery_life_hours":24,"waterproof_rating":"IPX7","bluetooth_version":"5.3","weight_grams":540}'::jsonb),
  ('60000000-0000-0000-0000-000000000002', 'BassMaster Wireless Noise-Cancelling Headphones (SAMPLE)', 'Over-ear wireless headphones with active noise cancellation, 40mm drivers, and 30-hour battery life.', 'BassMaster', '50000000-0000-0000-0000-000000000001', '{"driver_size_mm":40,"anc_enabled":true,"battery_life_hours":30,"connectivity":"Bluetooth 5.2"}'::jsonb),
  ('60000000-0000-0000-0000-000000000003', 'SonicAir True Wireless Bluetooth Earphones (SAMPLE)', 'Compact Bluetooth earphones with deep bass, low latency gaming mode, and 28-hour playtime with charging case.', 'SonicAir', '50000000-0000-0000-0000-000000000001', '{"driver_size_mm":10,"playtime_hours":28,"water_resistance":"IPX5","bluetooth_version":"5.3"}'::jsonb),
  ('60000000-0000-0000-0000-000000000004', 'StudioPro USB Condenser Studio Microphone (SAMPLE)', 'Cardioid polar pattern USB condenser microphone for podcasting, streaming, and studio voice recording.', 'StudioPro', '50000000-0000-0000-0000-000000000001', '{"polar_pattern":"Cardioid","sample_rate_khz":192,"bit_depth":24,"connector":"USB-C"}'::jsonb),
  ('60000000-0000-0000-0000-000000000005', 'SoundWave 2.1 Channel Cinema Soundbar (SAMPLE)', '120W cinematic soundbar with wireless subwoofer, HDMI ARC, optical input, and Bluetooth 5.0 streaming.', 'SoundWave', '50000000-0000-0000-0000-000000000001', '{"total_output_watts":120,"channels":"2.1","subwoofer":"Wireless","hdmi_arc":true}'::jsonb),
  ('60000000-0000-0000-0000-000000000006', 'ClearVoice Wireless Conference Speakerphone (SAMPLE)', '360-degree omnidirectional microphone array with AI noise reduction for clear business conference calls.', 'ClearVoice', '50000000-0000-0000-0000-000000000001', '{"mic_pickup_range_meters":5,"battery_hours":18,"connection":"USB / Bluetooth"}'::jsonb),
  ('60000000-0000-0000-0000-000000000007', 'BeatBox Mini Clip Bluetooth Speaker (SAMPLE)', 'Ultra-portable clip-on mini Bluetooth speaker with carabiner clip and punchy audio output.', 'BeatBox', '50000000-0000-0000-0000-000000000001', '{"power_watts":5,"battery_hours":10,"waterproof_rating":"IP67","clip_carabiner":true}'::jsonb),
  ('60000000-0000-0000-0000-000000000008', 'RetroHiFi Belt-Drive Vintage Vinyl Turntable (SAMPLE)', 'Classic wood-finish belt-drive turntable with built-in stereo preamp and wireless Bluetooth transmitter.', 'RetroHiFi', '50000000-0000-0000-0000-000000000001', '{"speeds_rpm":[33,45],"drive_type":"Belt-drive","built_in_preamp":true,"bluetooth_out":true}'::jsonb),
  ('60000000-0000-0000-0000-000000000009', 'PixelGlide 5G Smartphone 128GB (SAMPLE)', '6.7-inch 120Hz AMOLED display, 50MP triple camera system, Snapdragon processor, and 5000mAh battery.', 'PixelGlide', '50000000-0000-0000-0000-000000000002', '{"screen_inches":6.7,"storage_gb":128,"ram_gb":8,"camera_mp":50,"battery_mah":5000}'::jsonb),
  ('60000000-0000-0000-0000-000000000010', 'MagCharge 15W Qi Fast Wireless Charging Pad (SAMPLE)', 'Slim aluminum wireless charging pad with magnetic alignment, LED indicator, and foreign object detection.', 'MagCharge', '50000000-0000-0000-0000-000000000002', '{"output_watts":15,"standard":"Qi","connector":"USB-C","material":"Aluminum"}'::jsonb),
  ('60000000-0000-0000-0000-000000000011', 'UltraArmor Shockproof Heavy Duty Phone Case (SAMPLE)', 'Dual-layer military grade drop-tested protective bumper case with integrated tactile kickstand.', 'UltraArmor', '50000000-0000-0000-0000-000000000002', '{"drop_test_standard":"MIL-STD-810G","material":"Polycarbonate / TPU","kickstand":true}'::jsonb),
  ('60000000-0000-0000-0000-000000000012', 'PowerVault 20000mAh 65W PD Fast Power Bank (SAMPLE)', 'High-capacity power bank capable of charging laptops, phones, and tablets with 65W Power Delivery.', 'PowerVault', '50000000-0000-0000-0000-000000000002', '{"capacity_mah":20000,"max_output_watts":65,"ports":["USB-C","USB-A x2"],"display":"Digital LED"}'::jsonb),
  ('60000000-0000-0000-0000-000000000013', 'ApexView 9H Tempered Glass Screen Protector Pack (SAMPLE)', 'Ultra-thin scratch resistant 9H hardness tempered glass with oleophobic coating against fingerprints.', 'ApexView', '50000000-0000-0000-0000-000000000002', '{"hardness":"9H","thickness_mm":0.33,"clarity":"99.9% HD","pack_size":2}'::jsonb),
  ('60000000-0000-0000-0000-000000000014', 'SwiftType Magnetic Foldable Desk Phone Stand (SAMPLE)', 'Fully adjustable dual-hinge aluminum desktop stand compatible with all smartphones and small tablets.', 'SwiftType', '50000000-0000-0000-0000-000000000002', '{"material":"Anodized Aluminum","angle_adjustment_deg":270,"foldable":true}'::jsonb),
  ('60000000-0000-0000-0000-000000000015', 'CarMount Auto-Clamping Vent Phone Mount (SAMPLE)', 'Smart gravity sensor car air vent holder with one-handed automatic locking and silicone grip pads.', 'CarMount', '50000000-0000-0000-0000-000000000002', '{"mount_type":"Air Vent","rotation":"360 degree ball joint","clamping":"Gravity Auto"}'::jsonb),
  ('60000000-0000-0000-0000-000000000016', 'OmniCable 3-in-1 Nylon Braided Charging Cable (SAMPLE)', 'Durable 1.5m braided universal cable featuring Lightning, USB-C, and Micro-USB connectors.', 'OmniCable', '50000000-0000-0000-0000-000000000002', '{"length_meters":1.5,"connectors":["Lightning","USB-C","Micro-USB"],"current_amps":3}'::jsonb),
  ('60000000-0000-0000-0000-000000000017', 'ApexBook Pro 15.6 Laptop 16GB RAM 512GB SSD (SAMPLE)', 'Slim lightweight productivity laptop with Intel Core i7, 15.6-inch FHD anti-glare screen, and backlit keyboard.', 'ApexBook', '50000000-0000-0000-0000-000000000003', '{"processor":"Intel Core i7-1355U","ram_gb":16,"storage_gb":512,"screen_inches":15.6,"weight_kg":1.65}'::jsonb),
  ('60000000-0000-0000-0000-000000000018', 'TactilePro RGB Mechanical Gaming Keyboard (SAMPLE)', 'Hot-swappable mechanical switches, per-key RGB backlighting, aluminum top plate, and detachable cable.', 'TactilePro', '50000000-0000-0000-0000-000000000003', '{"switch_type":"Tactile Brown","layout":"Tenkeyless (TKL)","rgb_lighting":true,"interface":"USB-C"}'::jsonb),
  ('60000000-0000-0000-0000-000000000019', 'PrecisionFlow Wireless Ergonomic Vertical Mouse (SAMPLE)', 'Ergonomic 57-degree vertical handshake design to alleviate wrist strain with 4000 DPI optical sensor.', 'PrecisionFlow', '50000000-0000-0000-0000-000000000003', '{"dpi":4000,"angle_deg":57,"battery_life_months":24,"connection":"2.4GHz + Bluetooth"}'::jsonb),
  ('60000000-0000-0000-0000-000000000020', 'UltraWide 27-inch 4K IPS Desktop Monitor (SAMPLE)', '3840x2160 UHD resolution, 99% sRGB color accuracy, HDR400, USB-C 65W charging port, and height-adjustable stand.', 'UltraWide', '50000000-0000-0000-0000-000000000003', '{"screen_size_inches":27,"resolution":"3840x2160 UHD","refresh_rate_hz":75,"panel":"IPS","usb_c_pd":"65W"}'::jsonb),
  ('60000000-0000-0000-0000-000000000021', 'MultiPort 10-in-1 USB-C Hub Docking Station (SAMPLE)', 'Compact docking station with 4K HDMI, Gigabit Ethernet, SD card reader, 3x USB 3.0, and 100W PD pass-through.', 'MultiPort', '50000000-0000-0000-0000-000000000003', '{"ports_count":10,"hdmi_resolution":"4K@60Hz","ethernet_speed_mbps":1000,"pd_power_watts":100}'::jsonb),
  ('60000000-0000-0000-0000-000000000022', 'ClearStream 1080p 60fps Pro Streaming Webcam (SAMPLE)', 'Full HD streaming webcam with autofocus, dual stereo microphones, privacy shutter, and low-light enhancement.', 'ClearStream', '50000000-0000-0000-0000-000000000003', '{"resolution":"1080p","frame_rate_fps":60,"field_of_view_deg":90,"autofocus":true,"privacy_shutter":true}'::jsonb),
  ('60000000-0000-0000-0000-000000000023', 'SwiftDrive 1TB Portable NVMe External SSD (SAMPLE)', 'Ultra-fast external SSD delivering up to 1050 MB/s read speeds, drop-resistant aluminum casing, and hardware encryption.', 'SwiftDrive', '50000000-0000-0000-0000-000000000003', '{"capacity_tb":1,"read_speed_mbps":1050,"interface":"USB 3.2 Gen 2","drop_resistant_meters":2}'::jsonb),
  ('60000000-0000-0000-0000-000000000024', 'ErgoLift Aluminum Adjustable Laptop Riser (SAMPLE)', 'Ergonomic ventilated cooling stand with 6 adjustable height levels for laptops up to 17 inches.', 'ErgoLift', '50000000-0000-0000-0000-000000000003', '{"material":"Solid Aluminum","max_laptop_size_inches":17,"height_levels":6,"weight_capacity_kg":10}'::jsonb),
  ('60000000-0000-0000-0000-000000000025', 'AlphaCapture 4K Mirrorless Digital Camera (SAMPLE)', '24.2MP full-frame mirrorless camera with 5-axis image stabilization, 4K 60fps video, and dual SD card slots.', 'AlphaCapture', '50000000-0000-0000-0000-000000000004', '{"sensor":"Full-Frame CMOS","megapixel":24.2,"video_resolution":"4K@60fps","ibis_axis":5,"mount":"E-Mount"}'::jsonb),
  ('60000000-0000-0000-0000-000000000026', 'ActionCam 4K Waterproof Action Camera (SAMPLE)', 'Rugged action camera waterproof to 10m without case, dual color screens, HyperSmooth stabilization, and voice control.', 'ActionCam', '50000000-0000-0000-0000-000000000004', '{"video_resolution":"4K@60fps","waterproof_depth_meters":10,"dual_screen":true,"stabilization":"Electronic"}'::jsonb),
  ('60000000-0000-0000-0000-000000000027', 'HorizonPro 3-Axis Handheld Smartphone Gimbal (SAMPLE)', 'Motorized 3-axis stabilizer with AI face tracking, gesture controls, magnetic phone clamp, and 12-hour battery.', 'HorizonPro', '50000000-0000-0000-0000-000000000004', '{"axis_count":3,"tracking":"AI Smart Tracking","battery_hours":12,"max_payload_grams":290}'::jsonb),
  ('60000000-0000-0000-0000-000000000028', 'HaloRing 12-inch Bi-Color LED Ring Light Kit (SAMPLE)', 'Dimmable studio ring light with adjustable color temperature (3200K-5600K), phone holder, and 2m extendable tripod.', 'HaloRing', '50000000-0000-0000-0000-000000000004', '{"diameter_inches":12,"color_temp_kelvin":"3200K-5600K","power_watts":36,"tripod_height_meters":2.1}'::jsonb),
  ('60000000-0000-0000-0000-000000000029', 'CarbonTravel Compact Heavy-Duty Tripod (SAMPLE)', 'Lightweight carbon fiber travel tripod with 360-degree panoramic ball head and quick release Arca-Swiss plate.', 'CarbonTravel', '50000000-0000-0000-0000-000000000004', '{"material":"8-layer Carbon Fiber","max_height_cm":165,"folded_length_cm":42,"load_capacity_kg":12}'::jsonb),
  ('60000000-0000-0000-0000-000000000030', 'ProFocus 50mm f/1.8 Prime Portrait Camera Lens (SAMPLE)', 'Sharp prime portrait lens with fast f/1.8 aperture, creamy background bokeh, and quiet stepping autofocus motor.', 'ProFocus', '50000000-0000-0000-0000-000000000004', '{"focal_length_mm":50,"max_aperture":"f/1.8","filter_size_mm":49,"motor_type":"STM Autofocus"}'::jsonb),
  ('60000000-0000-0000-0000-000000000031', 'MemoryPro 128GB UHS-II V60 SDXC High Speed Card (SAMPLE)', 'Professional high-speed memory card delivering 280 MB/s read and 150 MB/s write for 4K video recording.', 'MemoryPro', '50000000-0000-0000-0000-000000000004', '{"capacity_gb":128,"speed_class":"V60 UHS-II U3","max_read_mbps":280,"max_write_mbps":150}'::jsonb),
  ('60000000-0000-0000-0000-000000000032', 'SkyDrone 4K Folding GPS Quadcopter Drone (SAMPLE)', 'Compact folding drone with 4K UHD stabilized camera, 31-minute flight time, GPS return-to-home, and 5km transmission.', 'SkyDrone', '50000000-0000-0000-0000-000000000004', '{"video_resolution":"4K@30fps","flight_time_mins":31,"transmission_range_km":5,"weight_grams":249}'::jsonb),
  ('60000000-0000-0000-0000-000000000033', 'PulseTrack Pro GPS Fitness Smartwatch (SAMPLE)', '1.43-inch AMOLED display, built-in dual-band GPS, 24/7 heart rate and blood oxygen tracking, 14-day battery.', 'PulseTrack', '50000000-0000-0000-0000-000000000005', '{"display":"1.43 AMOLED","gps":"Dual-Band","battery_days":14,"water_resistance":"5 ATM","sensors":["HR","SpO2","Stress"]}'::jsonb),
  ('60000000-0000-0000-0000-000000000034', 'ActiveFit Smart Fitness Band Tracker (SAMPLE)', 'Slim lightweight fitness band with continuous health monitoring, 120 sports modes, and 18-day battery life.', 'ActiveFit', '50000000-0000-0000-0000-000000000005', '{"display":"1.1 AMOLED","sports_modes":120,"battery_days":18,"water_resistance":"5 ATM"}'::jsonb),
  ('60000000-0000-0000-0000-000000000035', 'SmartGlow Multi-Color WiFi LED Smart Bulb 9W (SAMPLE)', '16 million colors, voice control with Alexa and Google Assistant, dimmable without hub, B22 socket.', 'SmartGlow', '50000000-0000-0000-0000-000000000005', '{"wattage":9,"lumens":800,"base":"B22","color_palette":"16 Million RGBW","connectivity":"WiFi 2.4GHz"}'::jsonb),
  ('60000000-0000-0000-0000-000000000036', 'SafeGuard Smart 2K Video Doorbell with Wireless Chime (SAMPLE)', '2K HD video with infrared night vision, two-way audio, smart motion alerts, and plug-in indoor chime.', 'SafeGuard', '50000000-0000-0000-0000-000000000005', '{"resolution":"2K Quad HD","night_vision":"Infrared","field_of_view_deg":160,"power":"Rechargeable Battery"}'::jsonb),
  ('60000000-0000-0000-0000-000000000037', 'SmartPlug 16A Energy Monitoring WiFi Plug (SAMPLE)', 'Heavy duty 16A smart socket for geysers and ACs with live energy consumption tracking and scheduled timers.', 'SmartPlug', '50000000-0000-0000-0000-000000000005', '{"max_load_amps":16,"power_rating_watts":3500,"energy_metering":true,"wifi_frequency":"2.4GHz"}'::jsonb),
  ('60000000-0000-0000-0000-000000000038', 'RoboVac Smart Laser Mapping Robotic Vacuum (SAMPLE)', 'LiDAR navigation with 4000Pa strong suction, 2-in-1 sweeping and mopping, virtual wall boundaries via mobile app.', 'RoboVac', '50000000-0000-0000-0000-000000000005', '{"suction_pa":4000,"navigation":"LiDAR Laser","battery_mah":5200,"runtime_mins":150,"mopping":true}'::jsonb),
  ('60000000-0000-0000-0000-000000000039', 'ComfortAir Smart Ultrasonic Room Humidifier 4L (SAMPLE)', '4-liter top-fill ultrasonic cool mist humidifier with auto humidity regulation, essential oil tray, and whisper-quiet operation.', 'ComfortAir', '50000000-0000-0000-0000-000000000005', '{"tank_capacity_liters":4,"output_ml_hr":300,"coverage_sqft":400,"noise_level_db":28}'::jsonb),
  ('60000000-0000-0000-0000-000000000040', 'AuraGlow Smart Sunrise Simulation Bedside Lamp (SAMPLE)', 'Wake-up light with sunrise simulation, FM radio, 7 natural alarm sounds, dual alarms, and USB phone charging port.', 'AuraGlow', '50000000-0000-0000-0000-000000000005', '{"brightness_levels":20,"alarm_sounds":7,"fm_radio":true,"sunrise_duration_mins":30}'::jsonb)
ON CONFLICT (product_id) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  brand = EXCLUDED.brand,
  category_id = EXCLUDED.category_id,
  specs = EXCLUDED.specs;

-- 9. Dealer Offers (Includes 5 Bluetooth Speaker offers + 1-unit offer + popular product offers)
INSERT INTO dealer_offers (offer_id, product_id, dealer_id, purchase_price, selling_price, status, bangalore_delivery_days, transfer_days_min, transfer_days_max, eligible_modes, warranty_months, warranty_note)
VALUES
  ('70000000-0000-0000-0000-000000000001', '60000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000005', 50000, 69900, 'active', 4, NULL, NULL, '{"standard"}'::text[], 12, 'Standard 1-year brand warranty'),
  ('70000000-0000-0000-0000-000000000002', '60000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000004', 60000, 77900, 'active', 1, NULL, NULL, '{"standard"}'::text[], 12, 'Express delivery warranty'),
  ('70000000-0000-0000-0000-000000000003', '60000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001', 55000, 74900, 'active', 2, NULL, NULL, '{"standard"}'::text[], 24, 'Premium 2-year dealer doorstep warranty'),
  ('70000000-0000-0000-0000-000000000004', '60000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000003', 52000, 72500, 'active', 2, NULL, NULL, '{"standard"}'::text[], 18, '18-month comprehensive warranty'),
  ('70000000-0000-0000-0000-000000000005', '60000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000002', 58000, 76900, 'active', 3, NULL, NULL, '{"standard"}'::text[], 12, 'Standard brand warranty'),
  ('70000000-0000-0000-0000-000000000006', '60000000-0000-0000-0000-000000000002', '40000000-0000-0000-0000-000000000001', 250000, 349900, 'active', 1, NULL, NULL, '{"standard"}'::text[], 12, '1-year manufacturer warranty'),
  ('70000000-0000-0000-0000-000000000007', '60000000-0000-0000-0000-000000000002', '40000000-0000-0000-0000-000000000002', 270000, 379900, 'active', 2, NULL, NULL, '{"standard"}'::text[], 12, '1-year warranty'),
  ('70000000-0000-0000-0000-000000000008', '60000000-0000-0000-0000-000000000002', '40000000-0000-0000-0000-000000000003', 260000, 359900, 'active', 1, NULL, NULL, '{"quick","standard"}'::text[], 12, 'Express local delivery'),
  ('70000000-0000-0000-0000-000000000009', '60000000-0000-0000-0000-000000000003', '40000000-0000-0000-0000-000000000006', 110000, 159900, 'active', 1, 2, 3, '{"standard"}'::text[], 12, '1-year dealer warranty'),
  ('70000000-0000-0000-0000-000000000010', '60000000-0000-0000-0000-000000000003', '40000000-0000-0000-0000-000000000004', 120000, 169900, 'active', 2, NULL, NULL, '{"standard"}'::text[], 12, '1-year warranty'),
  ('70000000-0000-0000-0000-000000000011', '60000000-0000-0000-0000-000000000004', '40000000-0000-0000-0000-000000000001', 450000, 599900, 'active', 1, NULL, NULL, '{"standard"}'::text[], 24, '2-year studio warranty'),
  ('70000000-0000-0000-0000-000000000012', '60000000-0000-0000-0000-000000000004', '40000000-0000-0000-0000-000000000002', 460000, 619900, 'active', 2, NULL, NULL, '{"standard"}'::text[], 12, '1-year warranty'),
  ('70000000-0000-0000-0000-000000000013', '60000000-0000-0000-0000-000000000005', '40000000-0000-0000-0000-000000000002', 600000, 799900, 'active', 2, NULL, NULL, '{"standard"}'::text[], 12, '1-year brand warranty'),
  ('70000000-0000-0000-0000-000000000014', '60000000-0000-0000-0000-000000000005', '40000000-0000-0000-0000-000000000005', 580000, 769900, 'active', 3, NULL, NULL, '{"standard"}'::text[], 12, '1-year brand warranty'),
  ('70000000-0000-0000-0000-000000000015', '60000000-0000-0000-0000-000000000006', '40000000-0000-0000-0000-000000000003', 320000, 449900, 'active', 1, NULL, NULL, '{"quick","standard"}'::text[], 12, '1-year replacement warranty'),
  ('70000000-0000-0000-0000-000000000016', '60000000-0000-0000-0000-000000000007', '40000000-0000-0000-0000-000000000004', 80000, 119900, 'active', 2, NULL, NULL, '{"standard"}'::text[], 6, '6-month warranty'),
  ('70000000-0000-0000-0000-000000000017', '60000000-0000-0000-0000-000000000007', '40000000-0000-0000-0000-000000000005', 75000, 109900, 'active', 3, NULL, NULL, '{"standard"}'::text[], 6, '6-month warranty'),
  ('70000000-0000-0000-0000-000000000018', '60000000-0000-0000-0000-000000000008', '40000000-0000-0000-0000-000000000001', 850000, 1149900, 'active', 2, NULL, NULL, '{"standard"}'::text[], 12, '1-year warranty'),
  ('70000000-0000-0000-0000-000000000019', '60000000-0000-0000-0000-000000000008', '40000000-0000-0000-0000-000000000006', 820000, 1099900, 'active', NULL, 2, 3, '{"standard"}'::text[], 12, '1-year dealer warranty'),
  ('70000000-0000-0000-0000-000000000020', '60000000-0000-0000-0000-000000000009', '40000000-0000-0000-0000-000000000001', 2200000, 2799900, 'active', 1, NULL, NULL, '{"quick","standard"}'::text[], 12, '1-year official brand warranty'),
  ('70000000-0000-0000-0000-000000000021', '60000000-0000-0000-0000-000000000009', '40000000-0000-0000-0000-000000000003', 2150000, 2699900, 'active', 2, NULL, NULL, '{"standard"}'::text[], 12, '1-year brand warranty'),
  ('70000000-0000-0000-0000-000000000022', '60000000-0000-0000-0000-000000000009', '40000000-0000-0000-0000-000000000005', 2100000, 2649900, 'active', 3, NULL, NULL, '{"standard"}'::text[], 12, '1-year brand warranty'),
  ('70000000-0000-0000-0000-000000000023', '60000000-0000-0000-0000-000000000010', '40000000-0000-0000-0000-000000000002', 90000, 149900, 'active', 1, NULL, NULL, '{"quick","standard"}'::text[], 12, '1-year replacement warranty'),
  ('70000000-0000-0000-0000-000000000024', '60000000-0000-0000-0000-000000000010', '40000000-0000-0000-0000-000000000004', 85000, 139900, 'active', 2, NULL, NULL, '{"standard"}'::text[], 6, '6-month warranty'),
  ('70000000-0000-0000-0000-000000000025', '60000000-0000-0000-0000-000000000011', '40000000-0000-0000-0000-000000000003', 25000, 49900, 'active', 1, NULL, NULL, '{"quick","standard"}'::text[], 3, '3-month warranty'),
  ('70000000-0000-0000-0000-000000000026', '60000000-0000-0000-0000-000000000011', '40000000-0000-0000-0000-000000000005', 20000, 39900, 'active', 3, NULL, NULL, '{"standard"}'::text[], 3, '3-month warranty'),
  ('70000000-0000-0000-0000-000000000027', '60000000-0000-0000-0000-000000000012', '40000000-0000-0000-0000-000000000001', 180000, 249900, 'active', 1, NULL, NULL, '{"quick","standard"}'::text[], 12, '1-year warranty'),
  ('70000000-0000-0000-0000-000000000028', '60000000-0000-0000-0000-000000000012', '40000000-0000-0000-0000-000000000002', 175000, 239900, 'active', 2, NULL, NULL, '{"standard"}'::text[], 12, '1-year warranty'),
  ('70000000-0000-0000-0000-000000000029', '60000000-0000-0000-0000-000000000012', '40000000-0000-0000-0000-000000000004', 170000, 229900, 'active', 3, NULL, NULL, '{"standard"}'::text[], 6, '6-month warranty'),
  ('70000000-0000-0000-0000-000000000030', '60000000-0000-0000-0000-000000000013', '40000000-0000-0000-0000-000000000003', 15000, 29900, 'active', 1, NULL, NULL, '{"quick","standard"}'::text[], 0, NULL),
  ('70000000-0000-0000-0000-000000000031', '60000000-0000-0000-0000-000000000014', '40000000-0000-0000-0000-000000000005', 28000, 49900, 'active', 2, NULL, NULL, '{"standard"}'::text[], 6, '6-month warranty'),
  ('70000000-0000-0000-0000-000000000032', '60000000-0000-0000-0000-000000000015', '40000000-0000-0000-0000-000000000004', 35000, 59900, 'active', 2, NULL, NULL, '{"standard"}'::text[], 6, '6-month warranty'),
  ('70000000-0000-0000-0000-000000000033', '60000000-0000-0000-0000-000000000016', '40000000-0000-0000-0000-000000000002', 18000, 34900, 'active', 1, NULL, NULL, '{"quick","standard"}'::text[], 6, '6-month warranty'),
  ('70000000-0000-0000-0000-000000000034', '60000000-0000-0000-0000-000000000017', '40000000-0000-0000-0000-000000000001', 4500000, 5499900, 'active', 1, NULL, NULL, '{"standard"}'::text[], 24, '2-year onsite warranty'),
  ('70000000-0000-0000-0000-000000000035', '60000000-0000-0000-0000-000000000017', '40000000-0000-0000-0000-000000000002', 4400000, 5399900, 'active', 2, NULL, NULL, '{"standard"}'::text[], 12, '1-year brand warranty'),
  ('70000000-0000-0000-0000-000000000036', '60000000-0000-0000-0000-000000000017', '40000000-0000-0000-0000-000000000006', 4350000, 5299900, 'active', NULL, 2, 3, '{"standard"}'::text[], 12, '1-year brand warranty'),
  ('70000000-0000-0000-0000-000000000037', '60000000-0000-0000-0000-000000000018', '40000000-0000-0000-0000-000000000002', 280000, 399900, 'active', 1, NULL, NULL, '{"quick","standard"}'::text[], 12, '1-year warranty'),
  ('70000000-0000-0000-0000-000000000038', '60000000-0000-0000-0000-000000000018', '40000000-0000-0000-0000-000000000004', 270000, 379900, 'active', 2, NULL, NULL, '{"standard"}'::text[], 12, '1-year warranty'),
  ('70000000-0000-0000-0000-000000000039', '60000000-0000-0000-0000-000000000019', '40000000-0000-0000-0000-000000000003', 120000, 189900, 'active', 1, NULL, NULL, '{"quick","standard"}'::text[], 12, '1-year warranty'),
  ('70000000-0000-0000-0000-000000000040', '60000000-0000-0000-0000-000000000019', '40000000-0000-0000-0000-000000000005', 110000, 174900, 'active', 3, NULL, NULL, '{"standard"}'::text[], 12, '1-year warranty'),
  ('70000000-0000-0000-0000-000000000041', '60000000-0000-0000-0000-000000000020', '40000000-0000-0000-0000-000000000001', 1800000, 2399900, 'active', 1, NULL, NULL, '{"standard"}'::text[], 36, '3-year panel warranty'),
  ('70000000-0000-0000-0000-000000000042', '60000000-0000-0000-0000-000000000020', '40000000-0000-0000-0000-000000000002', 1750000, 2299900, 'active', 2, NULL, NULL, '{"standard"}'::text[], 36, '3-year panel warranty'),
  ('70000000-0000-0000-0000-000000000043', '60000000-0000-0000-0000-000000000021', '40000000-0000-0000-0000-000000000004', 220000, 329900, 'active', 2, NULL, NULL, '{"standard"}'::text[], 12, '1-year warranty'),
  ('70000000-0000-0000-0000-000000000044', '60000000-0000-0000-0000-000000000022', '40000000-0000-0000-0000-000000000003', 280000, 399900, 'active', 1, NULL, NULL, '{"quick","standard"}'::text[], 12, '1-year warranty'),
  ('70000000-0000-0000-0000-000000000045', '60000000-0000-0000-0000-000000000023', '40000000-0000-0000-0000-000000000001', 520000, 699900, 'active', 1, NULL, NULL, '{"quick","standard"}'::text[], 36, '3-year limited warranty'),
  ('70000000-0000-0000-0000-000000000046', '60000000-0000-0000-0000-000000000024', '40000000-0000-0000-0000-000000000005', 80000, 129900, 'active', 2, NULL, NULL, '{"standard"}'::text[], 12, '1-year warranty'),
  ('70000000-0000-0000-0000-000000000047', '60000000-0000-0000-0000-000000000025', '40000000-0000-0000-0000-000000000001', 8500000, 10499900, 'active', 1, NULL, NULL, '{"standard"}'::text[], 24, '2-year official sensor warranty'),
  ('70000000-0000-0000-0000-000000000048', '60000000-0000-0000-0000-000000000025', '40000000-0000-0000-0000-000000000002', 8400000, 10299900, 'active', 2, NULL, NULL, '{"standard"}'::text[], 24, '2-year brand warranty'),
  ('70000000-0000-0000-0000-000000000049', '60000000-0000-0000-0000-000000000025', '40000000-0000-0000-0000-000000000006', 8300000, 10199900, 'active', NULL, 2, 3, '{"standard"}'::text[], 24, '2-year brand warranty'),
  ('70000000-0000-0000-0000-000000000050', '60000000-0000-0000-0000-000000000026', '40000000-0000-0000-0000-000000000003', 1900000, 2499900, 'active', 1, NULL, NULL, '{"quick","standard"}'::text[], 12, '1-year warranty'),
  ('70000000-0000-0000-0000-000000000051', '60000000-0000-0000-0000-000000000026', '40000000-0000-0000-0000-000000000004', 1850000, 2399900, 'active', 2, NULL, NULL, '{"standard"}'::text[], 12, '1-year warranty'),
  ('70000000-0000-0000-0000-000000000052', '60000000-0000-0000-0000-000000000027', '40000000-0000-0000-0000-000000000002', 650000, 899900, 'active', 1, NULL, NULL, '{"quick","standard"}'::text[], 12, '1-year warranty'),
  ('70000000-0000-0000-0000-000000000053', '60000000-0000-0000-0000-000000000027', '40000000-0000-0000-0000-000000000005', 620000, 849900, 'active', 3, NULL, NULL, '{"standard"}'::text[], 12, '1-year warranty'),
  ('70000000-0000-0000-0000-000000000054', '60000000-0000-0000-0000-000000000028', '40000000-0000-0000-0000-000000000004', 180000, 279900, 'active', 2, NULL, NULL, '{"standard"}'::text[], 6, '6-month warranty'),
  ('70000000-0000-0000-0000-000000000055', '60000000-0000-0000-0000-000000000029', '40000000-0000-0000-0000-000000000001', 550000, 799900, 'active', 1, NULL, NULL, '{"standard"}'::text[], 24, '2-year warranty'),
  ('70000000-0000-0000-0000-000000000056', '60000000-0000-0000-0000-000000000030', '40000000-0000-0000-0000-000000000002', 800000, 1149900, 'active', 2, NULL, NULL, '{"standard"}'::text[], 24, '2-year brand warranty'),
  ('70000000-0000-0000-0000-000000000057', '60000000-0000-0000-0000-000000000031', '40000000-0000-0000-0000-000000000003', 350000, 499900, 'active', 1, NULL, NULL, '{"quick","standard"}'::text[], 60, '5-year manufacturer warranty'),
  ('70000000-0000-0000-0000-000000000058', '60000000-0000-0000-0000-000000000032', '40000000-0000-0000-0000-000000000001', 2800000, 3699900, 'active', 1, NULL, NULL, '{"standard"}'::text[], 12, '1-year warranty'),
  ('70000000-0000-0000-0000-000000000059', '60000000-0000-0000-0000-000000000033', '40000000-0000-0000-0000-000000000001', 320000, 449900, 'active', 1, NULL, NULL, '{"quick","standard"}'::text[], 12, '1-year brand warranty'),
  ('70000000-0000-0000-0000-000000000060', '60000000-0000-0000-0000-000000000033', '40000000-0000-0000-0000-000000000003', 310000, 429900, 'active', 2, NULL, NULL, '{"standard"}'::text[], 12, '1-year brand warranty'),
  ('70000000-0000-0000-0000-000000000061', '60000000-0000-0000-0000-000000000033', '40000000-0000-0000-0000-000000000005', 300000, 419900, 'active', 3, NULL, NULL, '{"standard"}'::text[], 12, '1-year brand warranty'),
  ('70000000-0000-0000-0000-000000000062', '60000000-0000-0000-0000-000000000034', '40000000-0000-0000-0000-000000000002', 140000, 199900, 'active', 1, NULL, NULL, '{"quick","standard"}'::text[], 12, '1-year warranty'),
  ('70000000-0000-0000-0000-000000000063', '60000000-0000-0000-0000-000000000034', '40000000-0000-0000-0000-000000000004', 135000, 189900, 'active', 2, NULL, NULL, '{"standard"}'::text[], 12, '1-year warranty'),
  ('70000000-0000-0000-0000-000000000064', '60000000-0000-0000-0000-000000000035', '40000000-0000-0000-0000-000000000003', 32000, 59900, 'active', 1, NULL, NULL, '{"quick","standard"}'::text[], 12, '1-year warranty'),
  ('70000000-0000-0000-0000-000000000065', '60000000-0000-0000-0000-000000000035', '40000000-0000-0000-0000-000000000005', 30000, 54900, 'active', 2, NULL, NULL, '{"standard"}'::text[], 12, '1-year warranty'),
  ('70000000-0000-0000-0000-000000000066', '60000000-0000-0000-0000-000000000036', '40000000-0000-0000-0000-000000000001', 420000, 599900, 'active', 1, NULL, NULL, '{"standard"}'::text[], 12, '1-year warranty'),
  ('70000000-0000-0000-0000-000000000067', '60000000-0000-0000-0000-000000000036', '40000000-0000-0000-0000-000000000002', 410000, 579900, 'active', 2, NULL, NULL, '{"standard"}'::text[], 12, '1-year warranty'),
  ('70000000-0000-0000-0000-000000000068', '60000000-0000-0000-0000-000000000037', '40000000-0000-0000-0000-000000000004', 55000, 89900, 'active', 1, NULL, NULL, '{"quick","standard"}'::text[], 12, '1-year warranty'),
  ('70000000-0000-0000-0000-000000000069', '60000000-0000-0000-0000-000000000037', '40000000-0000-0000-0000-000000000005', 50000, 79900, 'active', 2, NULL, NULL, '{"standard"}'::text[], 12, '1-year warranty'),
  ('70000000-0000-0000-0000-000000000070', '60000000-0000-0000-0000-000000000038', '40000000-0000-0000-0000-000000000001', 1800000, 2499900, 'active', 1, NULL, NULL, '{"standard"}'::text[], 12, '1-year motor warranty'),
  ('70000000-0000-0000-0000-000000000071', '60000000-0000-0000-0000-000000000038', '40000000-0000-0000-0000-000000000006', 1750000, 2399900, 'active', NULL, 2, 3, '{"standard"}'::text[], 12, '1-year warranty'),
  ('70000000-0000-0000-0000-000000000072', '60000000-0000-0000-0000-000000000039', '40000000-0000-0000-0000-000000000003', 140000, 219900, 'active', 1, NULL, NULL, '{"quick","standard"}'::text[], 12, '1-year warranty'),
  ('70000000-0000-0000-0000-000000000073', '60000000-0000-0000-0000-000000000039', '40000000-0000-0000-0000-000000000004', 135000, 209900, 'active', 2, NULL, NULL, '{"standard"}'::text[], 12, '1-year warranty'),
  ('70000000-0000-0000-0000-000000000074', '60000000-0000-0000-0000-000000000040', '40000000-0000-0000-0000-000000000002', 160000, 249900, 'active', 1, NULL, NULL, '{"quick","standard"}'::text[], 12, '1-year warranty'),
  ('70000000-0000-0000-0000-000000000075', '60000000-0000-0000-0000-000000000040', '40000000-0000-0000-0000-000000000005', 150000, 234900, 'active', 2, NULL, NULL, '{"standard"}'::text[], 12, '1-year warranty')
ON CONFLICT (offer_id) DO UPDATE SET
  purchase_price = EXCLUDED.purchase_price,
  selling_price = EXCLUDED.selling_price,
  status = EXCLUDED.status,
  bangalore_delivery_days = EXCLUDED.bangalore_delivery_days,
  transfer_days_min = EXCLUDED.transfer_days_min,
  transfer_days_max = EXCLUDED.transfer_days_max,
  eligible_modes = EXCLUDED.eligible_modes,
  warranty_months = EXCLUDED.warranty_months,
  warranty_note = EXCLUDED.warranty_note;

-- 10. Inventory Records (Warehouse, Hub, Quarantine, Mysuru Holding; Includes 1-unit stock)
INSERT INTO inventory (inventory_id, offer_id, location_id, quantity, reserved_quantity)
VALUES
  ('80000000-0000-0000-0000-000000000001', '70000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 12, 0),
  ('80000000-0000-0000-0000-000000000002', '70000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', 6, 0),
  ('80000000-0000-0000-0000-000000000003', '70000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001', 8, 0),
  ('80000000-0000-0000-0000-000000000004', '70000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000001', 9, 0),
  ('80000000-0000-0000-0000-000000000005', '70000000-0000-0000-0000-000000000005', '10000000-0000-0000-0000-000000000001', 40, 0),
  ('80000000-0000-0000-0000-000000000006', '70000000-0000-0000-0000-000000000006', '10000000-0000-0000-0000-000000000001', 1, 0),
  ('80000000-0000-0000-0000-000000000007', '70000000-0000-0000-0000-000000000007', '10000000-0000-0000-0000-000000000001', 25, 0),
  ('80000000-0000-0000-0000-000000000008', '70000000-0000-0000-0000-000000000008', '10000000-0000-0000-0000-000000000002', 15, 0),
  ('80000000-0000-0000-0000-000000000009', '70000000-0000-0000-0000-000000000009', '10000000-0000-0000-0000-000000000001', 15, 0),
  ('80000000-0000-0000-0000-000000000010', '70000000-0000-0000-0000-000000000009', '10000000-0000-0000-0000-000000000004', 25, 0),
  ('80000000-0000-0000-0000-000000000011', '70000000-0000-0000-0000-000000000010', '10000000-0000-0000-0000-000000000001', 30, 0),
  ('80000000-0000-0000-0000-000000000012', '70000000-0000-0000-0000-000000000019', '10000000-0000-0000-0000-000000000004', 10, 0),
  ('80000000-0000-0000-0000-000000000013', '70000000-0000-0000-0000-000000000005', '10000000-0000-0000-0000-000000000003', 5, 0),
  ('80000000-0000-0000-0000-000000000014', '70000000-0000-0000-0000-000000000011', '10000000-0000-0000-0000-000000000001', 15, 0),
  ('80000000-0000-0000-0000-000000000015', '70000000-0000-0000-0000-000000000012', '10000000-0000-0000-0000-000000000001', 22, 0),
  ('80000000-0000-0000-0000-000000000016', '70000000-0000-0000-0000-000000000013', '10000000-0000-0000-0000-000000000001', 29, 0),
  ('80000000-0000-0000-0000-000000000017', '70000000-0000-0000-0000-000000000014', '10000000-0000-0000-0000-000000000001', 36, 0),
  ('80000000-0000-0000-0000-000000000018', '70000000-0000-0000-0000-000000000015', '10000000-0000-0000-0000-000000000002', 43, 0),
  ('80000000-0000-0000-0000-000000000019', '70000000-0000-0000-0000-000000000016', '10000000-0000-0000-0000-000000000001', 15, 0),
  ('80000000-0000-0000-0000-000000000020', '70000000-0000-0000-0000-000000000017', '10000000-0000-0000-0000-000000000001', 22, 0),
  ('80000000-0000-0000-0000-000000000021', '70000000-0000-0000-0000-000000000018', '10000000-0000-0000-0000-000000000001', 29, 0),
  ('80000000-0000-0000-0000-000000000022', '70000000-0000-0000-0000-000000000020', '10000000-0000-0000-0000-000000000002', 36, 0),
  ('80000000-0000-0000-0000-000000000023', '70000000-0000-0000-0000-000000000021', '10000000-0000-0000-0000-000000000001', 43, 0),
  ('80000000-0000-0000-0000-000000000024', '70000000-0000-0000-0000-000000000022', '10000000-0000-0000-0000-000000000001', 15, 0),
  ('80000000-0000-0000-0000-000000000025', '70000000-0000-0000-0000-000000000023', '10000000-0000-0000-0000-000000000002', 22, 0),
  ('80000000-0000-0000-0000-000000000026', '70000000-0000-0000-0000-000000000024', '10000000-0000-0000-0000-000000000001', 29, 0),
  ('80000000-0000-0000-0000-000000000027', '70000000-0000-0000-0000-000000000025', '10000000-0000-0000-0000-000000000002', 36, 0),
  ('80000000-0000-0000-0000-000000000028', '70000000-0000-0000-0000-000000000026', '10000000-0000-0000-0000-000000000001', 43, 0),
  ('80000000-0000-0000-0000-000000000029', '70000000-0000-0000-0000-000000000027', '10000000-0000-0000-0000-000000000002', 15, 0),
  ('80000000-0000-0000-0000-000000000030', '70000000-0000-0000-0000-000000000028', '10000000-0000-0000-0000-000000000001', 22, 0),
  ('80000000-0000-0000-0000-000000000031', '70000000-0000-0000-0000-000000000029', '10000000-0000-0000-0000-000000000001', 29, 0),
  ('80000000-0000-0000-0000-000000000032', '70000000-0000-0000-0000-000000000030', '10000000-0000-0000-0000-000000000002', 36, 0),
  ('80000000-0000-0000-0000-000000000033', '70000000-0000-0000-0000-000000000031', '10000000-0000-0000-0000-000000000001', 43, 0),
  ('80000000-0000-0000-0000-000000000034', '70000000-0000-0000-0000-000000000032', '10000000-0000-0000-0000-000000000001', 15, 0),
  ('80000000-0000-0000-0000-000000000035', '70000000-0000-0000-0000-000000000033', '10000000-0000-0000-0000-000000000002', 22, 0),
  ('80000000-0000-0000-0000-000000000036', '70000000-0000-0000-0000-000000000034', '10000000-0000-0000-0000-000000000001', 29, 0),
  ('80000000-0000-0000-0000-000000000037', '70000000-0000-0000-0000-000000000035', '10000000-0000-0000-0000-000000000001', 36, 0),
  ('80000000-0000-0000-0000-000000000038', '70000000-0000-0000-0000-000000000036', '10000000-0000-0000-0000-000000000004', 43, 0),
  ('80000000-0000-0000-0000-000000000039', '70000000-0000-0000-0000-000000000037', '10000000-0000-0000-0000-000000000002', 15, 0),
  ('80000000-0000-0000-0000-000000000040', '70000000-0000-0000-0000-000000000038', '10000000-0000-0000-0000-000000000001', 22, 0),
  ('80000000-0000-0000-0000-000000000041', '70000000-0000-0000-0000-000000000039', '10000000-0000-0000-0000-000000000002', 29, 0),
  ('80000000-0000-0000-0000-000000000042', '70000000-0000-0000-0000-000000000040', '10000000-0000-0000-0000-000000000001', 36, 0),
  ('80000000-0000-0000-0000-000000000043', '70000000-0000-0000-0000-000000000041', '10000000-0000-0000-0000-000000000001', 43, 0),
  ('80000000-0000-0000-0000-000000000044', '70000000-0000-0000-0000-000000000042', '10000000-0000-0000-0000-000000000001', 15, 0),
  ('80000000-0000-0000-0000-000000000045', '70000000-0000-0000-0000-000000000043', '10000000-0000-0000-0000-000000000001', 22, 0),
  ('80000000-0000-0000-0000-000000000046', '70000000-0000-0000-0000-000000000044', '10000000-0000-0000-0000-000000000002', 29, 0),
  ('80000000-0000-0000-0000-000000000047', '70000000-0000-0000-0000-000000000045', '10000000-0000-0000-0000-000000000002', 36, 0),
  ('80000000-0000-0000-0000-000000000048', '70000000-0000-0000-0000-000000000046', '10000000-0000-0000-0000-000000000001', 43, 0),
  ('80000000-0000-0000-0000-000000000049', '70000000-0000-0000-0000-000000000047', '10000000-0000-0000-0000-000000000001', 15, 0),
  ('80000000-0000-0000-0000-000000000050', '70000000-0000-0000-0000-000000000048', '10000000-0000-0000-0000-000000000001', 22, 0),
  ('80000000-0000-0000-0000-000000000051', '70000000-0000-0000-0000-000000000049', '10000000-0000-0000-0000-000000000004', 29, 0),
  ('80000000-0000-0000-0000-000000000052', '70000000-0000-0000-0000-000000000050', '10000000-0000-0000-0000-000000000002', 36, 0),
  ('80000000-0000-0000-0000-000000000053', '70000000-0000-0000-0000-000000000051', '10000000-0000-0000-0000-000000000001', 43, 0),
  ('80000000-0000-0000-0000-000000000054', '70000000-0000-0000-0000-000000000052', '10000000-0000-0000-0000-000000000002', 15, 0),
  ('80000000-0000-0000-0000-000000000055', '70000000-0000-0000-0000-000000000053', '10000000-0000-0000-0000-000000000001', 22, 0),
  ('80000000-0000-0000-0000-000000000056', '70000000-0000-0000-0000-000000000054', '10000000-0000-0000-0000-000000000001', 29, 0),
  ('80000000-0000-0000-0000-000000000057', '70000000-0000-0000-0000-000000000055', '10000000-0000-0000-0000-000000000001', 36, 0),
  ('80000000-0000-0000-0000-000000000058', '70000000-0000-0000-0000-000000000056', '10000000-0000-0000-0000-000000000001', 43, 0),
  ('80000000-0000-0000-0000-000000000059', '70000000-0000-0000-0000-000000000057', '10000000-0000-0000-0000-000000000002', 15, 0),
  ('80000000-0000-0000-0000-000000000060', '70000000-0000-0000-0000-000000000058', '10000000-0000-0000-0000-000000000001', 22, 0),
  ('80000000-0000-0000-0000-000000000061', '70000000-0000-0000-0000-000000000059', '10000000-0000-0000-0000-000000000002', 29, 0),
  ('80000000-0000-0000-0000-000000000062', '70000000-0000-0000-0000-000000000060', '10000000-0000-0000-0000-000000000001', 36, 0),
  ('80000000-0000-0000-0000-000000000063', '70000000-0000-0000-0000-000000000061', '10000000-0000-0000-0000-000000000001', 43, 0),
  ('80000000-0000-0000-0000-000000000064', '70000000-0000-0000-0000-000000000062', '10000000-0000-0000-0000-000000000002', 15, 0),
  ('80000000-0000-0000-0000-000000000065', '70000000-0000-0000-0000-000000000063', '10000000-0000-0000-0000-000000000001', 22, 0),
  ('80000000-0000-0000-0000-000000000066', '70000000-0000-0000-0000-000000000064', '10000000-0000-0000-0000-000000000002', 29, 0),
  ('80000000-0000-0000-0000-000000000067', '70000000-0000-0000-0000-000000000065', '10000000-0000-0000-0000-000000000001', 36, 0),
  ('80000000-0000-0000-0000-000000000068', '70000000-0000-0000-0000-000000000066', '10000000-0000-0000-0000-000000000001', 43, 0),
  ('80000000-0000-0000-0000-000000000069', '70000000-0000-0000-0000-000000000067', '10000000-0000-0000-0000-000000000001', 15, 0),
  ('80000000-0000-0000-0000-000000000070', '70000000-0000-0000-0000-000000000068', '10000000-0000-0000-0000-000000000002', 22, 0),
  ('80000000-0000-0000-0000-000000000071', '70000000-0000-0000-0000-000000000069', '10000000-0000-0000-0000-000000000001', 29, 0),
  ('80000000-0000-0000-0000-000000000072', '70000000-0000-0000-0000-000000000070', '10000000-0000-0000-0000-000000000001', 36, 0),
  ('80000000-0000-0000-0000-000000000073', '70000000-0000-0000-0000-000000000071', '10000000-0000-0000-0000-000000000004', 43, 0),
  ('80000000-0000-0000-0000-000000000074', '70000000-0000-0000-0000-000000000072', '10000000-0000-0000-0000-000000000002', 15, 0),
  ('80000000-0000-0000-0000-000000000075', '70000000-0000-0000-0000-000000000073', '10000000-0000-0000-0000-000000000001', 22, 0),
  ('80000000-0000-0000-0000-000000000076', '70000000-0000-0000-0000-000000000074', '10000000-0000-0000-0000-000000000002', 29, 0),
  ('80000000-0000-0000-0000-000000000077', '70000000-0000-0000-0000-000000000075', '10000000-0000-0000-0000-000000000001', 36, 0)
ON CONFLICT (offer_id, location_id) DO UPDATE SET
  quantity = EXCLUDED.quantity,
  reserved_quantity = EXCLUDED.reserved_quantity;

-- 11. Sample Price History (Closed past periods where valid_to is NOT NULL)
INSERT INTO offer_price_history (offer_id, selling_price, valid_from, valid_to)
SELECT '70000000-0000-0000-0000-000000000001', 89900, NOW() - INTERVAL '20 days', NOW() - INTERVAL '1 days'
WHERE NOT EXISTS (
  SELECT 1 FROM offer_price_history
  WHERE offer_id = '70000000-0000-0000-0000-000000000001' AND valid_to = NOW() - INTERVAL '1 days'
);
INSERT INTO offer_price_history (offer_id, selling_price, valid_from, valid_to)
SELECT '70000000-0000-0000-0000-000000000004', 79900, NOW() - INTERVAL '20 days', NOW() - INTERVAL '1 days'
WHERE NOT EXISTS (
  SELECT 1 FROM offer_price_history
  WHERE offer_id = '70000000-0000-0000-0000-000000000004' AND valid_to = NOW() - INTERVAL '1 days'
);
INSERT INTO offer_price_history (offer_id, selling_price, valid_from, valid_to)
SELECT '70000000-0000-0000-0000-000000000006', 399900, NOW() - INTERVAL '20 days', NOW() - INTERVAL '1 days'
WHERE NOT EXISTS (
  SELECT 1 FROM offer_price_history
  WHERE offer_id = '70000000-0000-0000-0000-000000000006' AND valid_to = NOW() - INTERVAL '1 days'
);
INSERT INTO offer_price_history (offer_id, selling_price, valid_from, valid_to)
SELECT '70000000-0000-0000-0000-000000000020', 2999900, NOW() - INTERVAL '20 days', NOW() - INTERVAL '1 days'
WHERE NOT EXISTS (
  SELECT 1 FROM offer_price_history
  WHERE offer_id = '70000000-0000-0000-0000-000000000020' AND valid_to = NOW() - INTERVAL '1 days'
);
INSERT INTO offer_price_history (offer_id, selling_price, valid_from, valid_to)
SELECT '70000000-0000-0000-0000-000000000034', 5999900, NOW() - INTERVAL '20 days', NOW() - INTERVAL '1 days'
WHERE NOT EXISTS (
  SELECT 1 FROM offer_price_history
  WHERE offer_id = '70000000-0000-0000-0000-000000000034' AND valid_to = NOW() - INTERVAL '1 days'
);

-- 12. Coupons (SAVE10, WELCOME50, FESTIVE15, BAZAAR100)
INSERT INTO coupons (coupon_id, code, kind, value, min_basket_paise, max_redemptions, redeemed_count, per_customer_limit, valid_from, valid_to, active)
VALUES
  ('90000000-0000-0000-0000-000000000001', 'SINGLE10', 'percent', 10, 49900, 1, 0, 1, NOW() + INTERVAL '-10 days', NOW() + INTERVAL '60 days', true),
  ('90000000-0000-0000-0000-000000000002', 'PERCUST1', 'fixed_paise', 5000, 49900, 100, 0, 1, NOW() + INTERVAL '-10 days', NOW() + INTERVAL '60 days', true),
  ('90000000-0000-0000-0000-000000000003', 'SAVE10', 'percent', 10, 99900, null, 0, 5, NOW() + INTERVAL '-10 days', NOW() + INTERVAL '90 days', true)
ON CONFLICT (code) DO UPDATE SET
  kind = EXCLUDED.kind,
  value = EXCLUDED.value,
  min_basket_paise = EXCLUDED.min_basket_paise,
  max_redemptions = EXCLUDED.max_redemptions,
  per_customer_limit = EXCLUDED.per_customer_limit,
  valid_from = EXCLUDED.valid_from,
  valid_to = EXCLUDED.valid_to,
  active = EXCLUDED.active;

COMMIT;