const path = require("path");
const fs = require("fs");
const express = require("express");
const session = require("express-session");
const SQLiteStore = require("connect-sqlite3")(session);
const Database = require("better-sqlite3");
const bcrypt = require("bcryptjs");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
require("dotenv").config();

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const NODE_ENV = process.env.NODE_ENV || "development";
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const DB_FILE = path.join(DATA_DIR, "app.sqlite");

if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32) {
  if (NODE_ENV === "production") {
    throw new Error("SESSION_SECRET must be set to a random value of at least 32 characters.");
  }
  console.warn("Using a development-only session secret. Set SESSION_SECRET before deployment.");
}

fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(DB_FILE);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    identifier TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
`);

const findUser = db.prepare("SELECT id, identifier, password_hash FROM users WHERE identifier = ?");
const createUser = db.prepare("INSERT INTO users (identifier, password_hash) VALUES (?, ?)");

app.disable("x-powered-by");
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: "10kb" }));
app.use(express.urlencoded({ extended: false, limit: "10kb" }));

if (NODE_ENV === "production") app.set("trust proxy", 1);

app.use(session({
  name: "mm1.sid",
  store: new SQLiteStore({
    db: "sessions.sqlite",
    dir: DATA_DIR,
    table: "sessions",
    concurrentDB: true
  }),
  secret: process.env.SESSION_SECRET || "development-only-secret-change-before-deploy-12345",
  resave: false,
  saveUninitialized: false,
  rolling: true,
  cookie: {
    httpOnly: true,
    secure: NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 1000 * 60 * 60 * 8
  }
}));

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Too many attempts. Please try again in 15 minutes." }
});

require("./google-auth").installGoogleAuth(app, { db, limiter: authLimiter });

function requireAuth(req, res, next) {
  if (!req.session.user) {
    return res.status(401).json({ error: "Please sign in to continue." });
  }
  next();
}

app.post("/api/auth/register", authLimiter, async (req, res, next) => {
  try {
    const identifier = String(req.body.identifier || "").trim().toLowerCase();
    const password = String(req.body.password || "");

    if (identifier.length < 3 || identifier.length > 120) {
      return res.status(400).json({ error: "Username or email must be between 3 and 120 characters." });
    }
    if (/[\s]/.test(identifier)) {
      return res.status(400).json({ error: "Username or email cannot contain spaces." });
    }
    if (password.length < 8 || Buffer.byteLength(password, "utf8") > 72) {
      return res.status(400).json({ error: "Password must be at least 8 characters and at most 72 UTF-8 bytes." });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    let result;
    try {
      result = createUser.run(identifier, passwordHash);
    } catch (error) {
      if (error.code === "SQLITE_CONSTRAINT_UNIQUE") {
        return res.status(409).json({ error: "This username or email is already registered." });
      }
      throw error;
    }

    // Rotate the session identifier after registration to prevent session fixation.
    req.session.regenerate((error) => {
      if (error) return next(error);
      req.session.user = { id: Number(result.lastInsertRowid), identifier };
      req.session.save((saveError) => {
        if (saveError) return next(saveError);
        res.status(201).json({ user: req.session.user });
      });
    });
  } catch (error) {
    next(error);
  }
});

app.post("/api/auth/login", authLimiter, async (req, res, next) => {
  try {
    const identifier = String(req.body.identifier || "").trim().toLowerCase();
    const password = String(req.body.password || "");
    if (!identifier || !password) {
      return res.status(400).json({ error: "Enter your username or email and password." });
    }

    const user = findUser.get(identifier);
    const valid = user && await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ error: "Incorrect username/email or password." });
    }

    req.session.regenerate((error) => {
      if (error) return next(error);
      req.session.user = { id: user.id, identifier: user.identifier };
      req.session.save((saveError) => {
        if (saveError) return next(saveError);
        res.json({ user: req.session.user });
      });
    });
  } catch (error) {
    next(error);
  }
});

app.get("/api/auth/me", (req, res) => {
  res.json({ user: req.session.user || null });
});

app.post("/api/auth/logout", (req, res, next) => {
  req.session.destroy((error) => {
    if (error) return next(error);
    res.clearCookie("mm1.sid", {
      httpOnly: true,
      secure: NODE_ENV === "production",
      sameSite: "lax"
    });
    res.status(204).end();
  });
});

app.get("/dashboard", requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, "dashboard.html"));
});

// On the standalone Maskkan staging service, open the property website by default.
// The original mm1 project remains available on the main branch and its own service.
if (process.env.MASKKAN_STAGE === "true") {
 app.get(["/","/index.html"],(req,res)=>res.redirect(302,"/maskkan"));
}
// Serve only the intended public assets. Never expose the repository root,
// archives, tests, or SQLite files, including a custom DATA_DIR.
for (const [url, filename] of Object.entries({
  "/": "index.html",
  "/index.html": "index.html",
  "/script.js": "script.js",
  "/styles.css": "styles.css"
})) {
  if (process.env.MASKKAN_STAGE === "true" && (url === "/" || url === "/index.html")) continue;
  app.get(url, (req, res) => res.sendFile(path.join(__dirname, filename), {
    maxAge: NODE_ENV === "production" ? "1h" : 0,
    dotfiles: "deny"
  }));
}


// --- مسّكن: real-estate MVP. Reuses the existing mm1 users and sessions. ---
db.exec(`
 CREATE TABLE IF NOT EXISTS maskkan_properties (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id INTEGER NOT NULL REFERENCES users(id),
  title TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('rent','sale')),
  property_type TEXT NOT NULL,
  city TEXT NOT NULL,
  district TEXT NOT NULL,
  price INTEGER NOT NULL CHECK (price > 0),
  area_sqm INTEGER NOT NULL CHECK (area_sqm > 0),
  bedrooms INTEGER NOT NULL DEFAULT 0,
  bathrooms INTEGER NOT NULL DEFAULT 0,
  description TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
 );
 CREATE TABLE IF NOT EXISTS maskkan_images (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  property_id INTEGER NOT NULL REFERENCES maskkan_properties(id) ON DELETE CASCADE,
  mime TEXT NOT NULL CHECK (mime IN ('image/jpeg','image/png','image/webp')),
  data BLOB NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
 );
 CREATE INDEX IF NOT EXISTS maskkan_images_property_idx ON maskkan_images(property_id,id);
 CREATE TABLE IF NOT EXISTS maskkan_favorites (
  user_id INTEGER NOT NULL REFERENCES users(id),
  property_id INTEGER NOT NULL REFERENCES maskkan_properties(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, property_id)
 );
 CREATE INDEX IF NOT EXISTS maskkan_property_idx ON maskkan_properties (status,mode,city,property_type,price);
`);
// Backward-compatible migration: keep previously stored listings and photos intact.
if (!db.pragma('table_info(maskkan_properties)').some(col=>col.name==='is_available')) {
 db.exec('ALTER TABLE maskkan_properties ADD COLUMN is_available INTEGER NOT NULL DEFAULT 1 CHECK (is_available IN (0,1))');
}
const maskkanExtraColumns = db.pragma('table_info(maskkan_properties)').map(col=>col.name);
if(!maskkanExtraColumns.includes('rent_period'))db.exec("ALTER TABLE maskkan_properties ADD COLUMN rent_period TEXT NOT NULL DEFAULT 'monthly'");
if(!maskkanExtraColumns.includes('deposit'))db.exec("ALTER TABLE maskkan_properties ADD COLUMN deposit INTEGER NOT NULL DEFAULT 0");
if(!maskkanExtraColumns.includes('furnished'))db.exec("ALTER TABLE maskkan_properties ADD COLUMN furnished INTEGER NOT NULL DEFAULT 0");

const maskkanCities = ['عمّان','إربد','الزرقاء','المفرق','جرش','عجلون','البلقاء','مادبا','الكرك','الطفيلة','معان','العقبة'];
const maskkanTypes = ['شقة','فيلا','بيت','أرض','محل','مكتب','مزرعة','استوديو'];
const maskkanClean = (value, max) => String(value ?? '').trim().slice(0,max);
function maskkanParse(body) {
  const b = body || {};
  const p = {
    title:maskkanClean(b.title,110),mode:maskkanClean(b.mode,10),
    property_type:maskkanClean(b.property_type,25),
    city:maskkanClean(b.city,30),district:maskkanClean(b.district,80),
    price:Number(b.price),area_sqm:Number(b.area_sqm),
    bedrooms:Number(b.bedrooms ?? 0),bathrooms:Number(b.bathrooms ?? 0),
    description:maskkanClean(b.description,2000),phone:maskkanClean(b.phone,15),
    rent_period:b.mode==='rent'?maskkanClean(b.rent_period||'monthly',10):'monthly',
    deposit:b.mode==='rent'?Number(b.deposit??0):0,
    furnished:b.mode==='rent'?(b.furnished===true||b.furnished==='true'?1:0):0
  };
  if (p.title.length<8 || !['rent','sale'].includes(p.mode) ||
      !maskkanTypes.includes(p.property_type) || !maskkanCities.includes(p.city) ||
      p.district.length<2) return null;
  if (![p.price,p.area_sqm,p.bedrooms,p.bathrooms].every(Number.isSafeInteger) ||
      p.price<1 || p.price>100000000 || p.area_sqm<1 || p.area_sqm>1000000 ||
      p.bedrooms<0 || p.bedrooms>50 || p.bathrooms<0 || p.bathrooms>50) return null;
  if(!['monthly','yearly'].includes(p.rent_period) || !Number.isSafeInteger(p.deposit) || p.deposit<0 || p.deposit>1000000)return null;
  if (p.phone && !/^07[789]\d{7}$/.test(p.phone)) return null;
  return p;
}
function maskkanSameOrigin(req,res,next) {
  if (['GET','HEAD','OPTIONS'].includes(req.method)) return next();
  const origin = req.get('Origin');
  // Prefer the configured canonical origin in production; never trust forwarded hosts from clients.
  const expected = process.env.MASKKAN_PUBLIC_ORIGIN
    ? new URL(process.env.MASKKAN_PUBLIC_ORIGIN).host
    : req.get('Host');
  if (!origin || !expected) return res.status(403).json({error:'مصدر الطلب مطلوب'});
  try {
    if (new URL(origin).host !== expected) return res.status(403).json({error:'مصدر غير مصرح'});
  } catch { return res.status(403).json({error:'مصدر غير صالح'}); }
  next();
}
const maskkanLimiter = rateLimit({windowMs:15*60*1000,limit:30,standardHeaders:'draft-8',legacyHeaders:false});
const maskkanAuth = (req,res,next) => req.session.user ? next() : res.status(401).json({error:'سجل الدخول أولًا'});
const maskkanAdmin = (req,res,next) =>
  process.env.MASKKAN_ADMIN_IDENTIFIER &&
  process.env.MASKKAN_ADMIN_USER_ID &&
  req.session.user?.identifier === process.env.MASKKAN_ADMIN_IDENTIFIER.trim().toLowerCase() &&
  req.session.user?.id === Number(process.env.MASKKAN_ADMIN_USER_ID)
  ? next() : res.status(403).json({error:'ليس لديك صلاحية الإدارة'});
const maskkanFields='maskkan_properties.id,title,mode,property_type,city,district,price,area_sqm,bedrooms,bathrooms,description,status,is_available,rent_period,deposit,furnished,created_at,(SELECT id FROM maskkan_images WHERE property_id=maskkan_properties.id ORDER BY id LIMIT 1) AS cover_image_id';
app.get('/api/maskkan/properties', (req,res) => {
 const clauses=["status='approved'","is_available=1"], args=[];
 for (const key of ['mode','city','property_type']) {
   if(req.query[key]){clauses.push(key+'=?');args.push(maskkanClean(req.query[key],30));}
 }
 const min=req.query.min_price===undefined?null:Number(req.query.min_price);
 const max=req.query.max_price===undefined?null:Number(req.query.max_price);
 if((min!==null&&(!Number.isSafeInteger(min)||min<0)) ||
    (max!==null&&(!Number.isSafeInteger(max)||max<0)) ||
    (min!==null&&max!==null&&min>max)) return res.status(400).json({error:'نطاق السعر غير صحيح'});
 if(min!==null){clauses.push('price>=?');args.push(min);}
 if(max!==null){clauses.push('price<=?');args.push(max);}
 const order=req.query.sort==='price_asc'?'price ASC, id DESC':req.query.sort==='price_desc'?'price DESC, id DESC':'id DESC';
 const rawLimit=req.query.limit===undefined?24:Number(req.query.limit);
 const page=req.query.page===undefined?1:Number(req.query.page);
 if(!Number.isSafeInteger(rawLimit)||rawLimit<1||rawLimit>50||!Number.isSafeInteger(page)||page<1||page>10000)
   return res.status(400).json({error:'الصفحة أو عدد النتائج غير صالح'});
 const where=clauses.join(' AND ');
 const total=db.prepare('SELECT COUNT(*) AS total FROM maskkan_properties WHERE '+where).get(...args).total;
 const items=db.prepare('SELECT '+maskkanFields+' FROM maskkan_properties WHERE '+where+' ORDER BY '+order+' LIMIT ? OFFSET ?').all(...args,rawLimit,(page-1)*rawLimit);
 res.json({properties:items,page,total,hasMore:page*rawLimit<total});
});
app.patch('/api/maskkan/properties/:id/availability',maskkanSameOrigin,maskkanAuth,maskkanLimiter,(req,res)=>{
 if(typeof req.body?.available!=='boolean')return res.status(400).json({error:'الحالة غير صحيحة'});
 const owned=db.prepare('SELECT owner_id,is_available FROM maskkan_properties WHERE id=?').get(req.params.id);
 if(!owned)return res.status(404).json({error:'العقار غير موجود'});
 if(owned.owner_id!==req.session.user.id)return res.status(403).json({error:'ليس لديك صلاحية'});
 const available=req.body.available?1:0;
 if(available===1 && owned.is_available===0){
  db.prepare("UPDATE maskkan_properties SET is_available=1,status='pending' WHERE id=?").run(req.params.id);
  return res.json({available:true,status:'pending'});
 }
 db.prepare('UPDATE maskkan_properties SET is_available=? WHERE id=?').run(available,req.params.id);
 res.json({available:!!available});
});
app.get('/api/maskkan/properties/:id', (req,res) => {
 const item=db.prepare('SELECT '+maskkanFields+',phone FROM maskkan_properties WHERE id=? AND status=? AND is_available=1').get(req.params.id,'approved');
 if(!item)return res.status(404).json({error:'العقار غير متاح'});
 res.json({property:item});
});
app.get('/api/maskkan/mine',maskkanAuth,(req,res)=>{
 const items=db.prepare('SELECT '+maskkanFields+',phone FROM maskkan_properties WHERE owner_id=? ORDER BY id DESC').all(req.session.user.id);
 res.json({properties:items});
});
app.post('/api/maskkan/properties',maskkanSameOrigin,maskkanLimiter,maskkanAuth,(req,res)=>{
 const p=maskkanParse(req.body);
 if(!p)return res.status(400).json({error:'راجع معلومات العقار'});
 if(p.phone && req.body.contactConsent!==true)return res.status(400).json({error:'يجب الموافقة على نشر رقم الاتصال'});
 const columns=Object.keys(p);
 const result=db.prepare('INSERT INTO maskkan_properties(owner_id,'+columns.join(',')+') VALUES (?,'+columns.map(()=>'?').join(',')+')').run(req.session.user.id,...Object.values(p));
 res.status(201).json({id:Number(result.lastInsertRowid),status:'pending'});
});
app.put('/api/maskkan/properties/:id',maskkanSameOrigin,maskkanLimiter,maskkanAuth,(req,res)=>{
 const previous=db.prepare('SELECT owner_id FROM maskkan_properties WHERE id=?').get(req.params.id);
 if(!previous)return res.status(404).json({error:'العقار غير موجود'});
 if(previous.owner_id!==req.session.user.id)return res.status(403).json({error:'ليس لديك صلاحية'});
 const p=maskkanParse(req.body);
 if(!p)return res.status(400).json({error:'راجع معلومات العقار'});
 if(p.phone && req.body.contactConsent!==true)return res.status(400).json({error:'يجب الموافقة على نشر رقم الاتصال'});
 db.prepare('UPDATE maskkan_properties SET '+Object.keys(p).map(k=>k+'=?').join(',')+",status='pending' WHERE id=?").run(...Object.values(p),req.params.id);
 res.json({status:'pending'});
});
app.delete('/api/maskkan/properties/:id',maskkanSameOrigin,maskkanLimiter,maskkanAuth,(req,res)=>{
 const result=db.prepare('DELETE FROM maskkan_properties WHERE id=? AND owner_id=?').run(req.params.id,req.session.user.id);
 if(!result.changes)return res.status(404).json({error:'الإعلان غير موجود في حسابك'});
 res.status(204).end();
});
app.get('/api/maskkan/favorites',maskkanAuth,(req,res)=>{
 const rows=db.prepare("SELECT f.property_id AS id FROM maskkan_favorites f JOIN maskkan_properties p ON p.id=f.property_id WHERE f.user_id=? AND p.status='approved' AND p.is_available=1").all(req.session.user.id);
 res.json({ids:rows.map(row=>row.id)});
});
app.get('/api/maskkan/favorites/properties',maskkanAuth,(req,res)=>{
 const properties=db.prepare('SELECT '+maskkanFields+' FROM maskkan_properties JOIN maskkan_favorites f ON f.property_id=maskkan_properties.id WHERE f.user_id=? AND maskkan_properties.status=? AND maskkan_properties.is_available=1 ORDER BY f.property_id DESC LIMIT 100').all(req.session.user.id,'approved');
 res.json({properties});
});
app.post('/api/maskkan/favorites/:id',maskkanSameOrigin,maskkanLimiter,maskkanAuth,(req,res)=>{
 if(!db.prepare("SELECT id FROM maskkan_properties WHERE id=? AND status='approved' AND is_available=1").get(req.params.id))return res.status(404).json({error:'العقار غير متاح'});
 db.prepare('INSERT OR IGNORE INTO maskkan_favorites(user_id,property_id) VALUES (?,?)').run(req.session.user.id,req.params.id);
 res.status(204).end();
});
app.delete('/api/maskkan/favorites/:id',maskkanSameOrigin,maskkanLimiter,maskkanAuth,(req,res)=>{
 db.prepare('DELETE FROM maskkan_favorites WHERE user_id=? AND property_id=?').run(req.session.user.id,req.params.id);
 res.status(204).end();
});
app.get('/api/maskkan/admin/pending',maskkanAuth,maskkanAdmin,(req,res)=>{
 res.json({properties:db.prepare("SELECT "+maskkanFields+" FROM maskkan_properties WHERE status='pending' ORDER BY id DESC").all()});
});
app.patch('/api/maskkan/admin/properties/:id',maskkanSameOrigin,maskkanLimiter,maskkanAuth,maskkanAdmin,(req,res)=>{
 if(!['approved','rejected'].includes(req.body?.status))return res.status(400).json({error:'حالة غير صحيحة'});
 const result=db.prepare("UPDATE maskkan_properties SET status=? WHERE id=? AND status='pending'").run(req.body.status,req.params.id);
 if(!result.changes)return res.status(404).json({error:'الإعلان غير معلق'});
 res.json({status:req.body.status});
});

const maskkanImageMime = ['image/jpeg','image/png','image/webp'];
const maskkanRawImage = express.raw({type:maskkanImageMime,limit:'2mb'});
function maskkanValidImage(data, mime) {
 if(!Buffer.isBuffer(data) || data.length<40 || data.length>2*1024*1024)return false;
 if(mime==='image/jpeg')return data[0]===0xff && data[1]===0xd8 && data[2]===0xff && data[data.length-2]===0xff && data[data.length-1]===0xd9;
 if(mime==='image/png')return data.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
 if(mime==='image/webp')return data.toString('ascii',0,4)==='RIFF' && data.toString('ascii',8,12)==='WEBP';
 return false;
}
app.post('/api/maskkan/properties/:id/images',maskkanSameOrigin,maskkanAuth,maskkanLimiter,maskkanRawImage,(req,res)=>{
 const property=db.prepare('SELECT owner_id FROM maskkan_properties WHERE id=?').get(req.params.id);
 if(!property)return res.status(404).json({error:'العقار غير موجود'});
 if(property.owner_id!==req.session.user.id)return res.status(403).json({error:'ليس لديك صلاحية'});
 const mime=req.get('Content-Type')?.split(';')[0].trim().toLowerCase();
 if(!maskkanImageMime.includes(mime)||!maskkanValidImage(req.body,mime))return res.status(400).json({error:'أرسل صورة JPEG أو PNG أو WebP صالحة بحجم أقصى 2MB'});
 const upload=db.transaction(()=>{
   if(db.prepare('SELECT COUNT(*) AS count FROM maskkan_images WHERE property_id=?').get(req.params.id).count>=5)return null;
   const insert=db.prepare('INSERT INTO maskkan_images(property_id,mime,data) VALUES (?,?,?)').run(req.params.id,mime,req.body);
   db.prepare("UPDATE maskkan_properties SET status='pending' WHERE id=?").run(req.params.id);
   return Number(insert.lastInsertRowid);
 });
 const id=upload();
 if(id===null)return res.status(409).json({error:'الحد الأقصى خمس صور لكل عقار'});
 res.status(201).json({id,status:'pending'});
});
app.get('/api/maskkan/properties/:id/images',(req,res)=>{
 const property=db.prepare('SELECT owner_id,status,is_available FROM maskkan_properties WHERE id=?').get(req.params.id);
 if(!property || ((property.status!=='approved'||property.is_available===0) && req.session.user?.id!==property.owner_id && !(req.session.user?.identifier===process.env.MASKKAN_ADMIN_IDENTIFIER?.trim().toLowerCase() && process.env.MASKKAN_ADMIN_USER_ID && req.session.user?.id===Number(process.env.MASKKAN_ADMIN_USER_ID))))return res.status(404).json({error:'العقار غير متاح'});
 const images=db.prepare('SELECT id,mime FROM maskkan_images WHERE property_id=? ORDER BY id').all(req.params.id);
 res.json({images:images.map(x=>({id:x.id,mime:x.mime,url:'/api/maskkan/images/'+x.id}))});
});
app.get('/api/maskkan/images/:imageId',(req,res)=>{
 const image=db.prepare('SELECT i.data,i.mime,p.owner_id,p.status,p.is_available FROM maskkan_images i JOIN maskkan_properties p ON p.id=i.property_id WHERE i.id=?').get(req.params.imageId);
 if(!image || ((image.status!=='approved'||image.is_available===0) && req.session.user?.id!==image.owner_id && !(req.session.user?.identifier===process.env.MASKKAN_ADMIN_IDENTIFIER?.trim().toLowerCase() && process.env.MASKKAN_ADMIN_USER_ID && req.session.user?.id===Number(process.env.MASKKAN_ADMIN_USER_ID))))return res.status(404).end();
 res.set({'Content-Type':image.mime,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'});
 res.send(image.data);
});
app.delete('/api/maskkan/properties/:id/images/:imageId',maskkanSameOrigin,maskkanAuth,maskkanLimiter,(req,res)=>{
 const property=db.prepare('SELECT owner_id FROM maskkan_properties WHERE id=?').get(req.params.id);
 if(!property)return res.status(404).json({error:'العقار غير موجود'});
 if(property.owner_id!==req.session.user.id)return res.status(403).json({error:'ليس لديك صلاحية'});
 const changed=db.transaction(()=>{
  const result=db.prepare('DELETE FROM maskkan_images WHERE id=? AND property_id=?').run(req.params.imageId,req.params.id);
  if(result.changes)db.prepare("UPDATE maskkan_properties SET status='pending' WHERE id=?").run(req.params.id);
  return result.changes;
 })();
 if(!changed)return res.status(404).json({error:'الصورة غير موجودة'});
 res.status(204).end();
});

// Preserved interactive lamp login, sharing the same authentication API and sessions.
app.get('/api/maskkan/config', (req,res)=>res.json({
 googleEnabled: Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.GOOGLE_REDIRECT_URI)
}));
app.get('/maskkan/login', (req,res) => res.sendFile(path.join(__dirname,'maskkan-login','index.html')));
for (const asset of ['styles.css','script.js']) {
 app.get('/maskkan/login/'+asset,(req,res)=>res.sendFile(path.join(__dirname,'maskkan-login',asset),{dotfiles:'deny'}));
}
app.get('/maskkan', (req,res) => res.sendFile(path.join(__dirname,'maskkan-demo','index.html')));

app.use((req, res) => res.status(404).json({ error: "Page not found." }));

app.use((error, req, res, next) => {
  console.error(error);
  if (res.headersSent) return next(error);
  res.status(500).json({ error: "An unexpected server error occurred." });
});

app.listen(PORT, () => {
  console.log(`MM1 server running on port ${PORT}`);
});
