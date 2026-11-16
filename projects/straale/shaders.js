/**
 * GLSL-koden. All strålesporingen skjer i TRACE. Skjermkortet kjører den en gang
 * per piksel per bilde, og hvert bilde legges til et løpende gjennomsnitt.
 */
export const MAX_SPHERES = 24;

/** En trekant som dekker hele skjermen. Trenger ingen buffere: hjørnene regnes ut fra nummeret. */
export const VERTEX = `#version 300 es
void main() {
  vec2 corner = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(corner * 2.0 - 1.0, 0.0, 1.0);
}`;

export const TRACE = `#version 300 es
precision highp float;
precision highp int;

const int MAX_SPHERES = ${MAX_SPHERES};
const int DIFFUSE = 0, METAL = 1, GLASS = 2, LIGHT = 3;
const float PI = 3.14159265359;
const float FAR = 1e9;

uniform sampler2D uPrevious;   // gjennomsnittet av alle tidligere bilder
uniform int uSamples;          // antall bilder i gjennomsnittet så langt
uniform vec2 uResolution;
uniform vec3 uOrigin, uForward, uRight, uUp;
uniform float uTanHalfFov, uAperture, uFocus;
uniform int uBounces;

uniform int uCount;
uniform vec4 uSphere[MAX_SPHERES];    // xyz = sentrum, w = radius
uniform vec4 uMaterial[MAX_SPHERES];  // rgb = farge, a = type + parameter / 1000 (ruhet, brytningsindeks eller lysstyrke)

uniform vec3 uSkyTop, uSkyHorizon, uSunDirection, uSunColor;
uniform vec3 uGroundA, uGroundB;      // rutemønsteret på bakken
uniform float uGroundRoughness;       // under null: matt bakke. Ellers blank, med denne ruheten.
uniform bool uRoom;                   // fire vegger rundt scenen (lysrommet)

out vec4 outColor;

/* ---------- Tilfeldige tall: PCG-hashen fra Jarzynski og Olano, "Hash Functions for GPU Rendering" (2020).
   En tilstand per piksel, sådd fra posisjon og bildenummer. ---------- */
uint rngState;
uint pcg() {
  rngState = rngState * 747796405u + 2891336453u;
  uint word = ((rngState >> ((rngState >> 28u) + 4u)) ^ rngState) * 277803737u;
  return (word >> 22u) ^ word;
}
float rnd() { return float(pcg() >> 8u) / 16777216.0; } // [0, 1)

vec3 randomUnitVector() {
  float z = 1.0 - 2.0 * rnd(), angle = 2.0 * PI * rnd(), r = sqrt(max(0.0, 1.0 - z * z));
  return vec3(r * cos(angle), r * sin(angle), z);
}
vec2 randomInDisk() {
  float r = sqrt(rnd()), angle = 2.0 * PI * rnd();
  return r * vec2(cos(angle), sin(angle));
}

/* ---------- Scenen ---------- */
struct Hit { float t; vec3 normal; vec3 color; int type; float param; };

float hitSphere(vec3 ro, vec3 rd, vec4 sphere) {
  vec3 oc = ro - sphere.xyz;
  float b = dot(oc, rd), c = dot(oc, oc) - sphere.w * sphere.w;
  float disc = b * b - c;
  if (disc < 0.0) return FAR;
  float root = sqrt(disc);
  float t = -b - root;
  if (t > 1e-3) return t;
  t = -b + root;               // strålen starter inne i kula (glass)
  return t > 1e-3 ? t : FAR;
}

/** En vegg: et plan vinkelrett på en akse, avgrenset til rommet. */
void hitWall(vec3 ro, vec3 rd, int axis, float at, vec3 color, inout Hit hit) {
  float t = (at - ro[axis]) / rd[axis];
  if (t < 1e-3 || t >= hit.t) return;
  vec3 p = ro + rd * t;
  if (abs(p.x) > 3.001 || abs(p.z) > 3.001 || p.y > 5.001 || p.y < 0.0) return;
  vec3 n = vec3(0.0);
  n[axis] = rd[axis] > 0.0 ? -1.0 : 1.0;
  hit = Hit(t, n, color, DIFFUSE, 0.0);
}

Hit intersect(vec3 ro, vec3 rd) {
  Hit hit = Hit(FAR, vec3(0.0), vec3(0.0), DIFFUSE, 0.0);

  for (int i = 0; i < MAX_SPHERES; i++) {
    if (i >= uCount) break;
    float t = hitSphere(ro, rd, uSphere[i]);
    if (t < hit.t) {
      float kind = floor(uMaterial[i].a);
      hit = Hit(t, (ro + rd * t - uSphere[i].xyz) / uSphere[i].w, uMaterial[i].rgb, int(kind), (uMaterial[i].a - kind) * 1000.0);
    }
  }

  // Bakken: planet y = 0, med rutemønster.
  if (rd.y < 0.0) {
    float t = -ro.y / rd.y;
    if (t > 1e-3 && t < hit.t) {
      vec3 p = ro + rd * t;
      bool odd = mod(floor(p.x) + floor(p.z), 2.0) > 0.5;
      hit = Hit(t, vec3(0.0, 1.0, 0.0), odd ? uGroundA : uGroundB, uGroundRoughness < 0.0 ? DIFFUSE : METAL, max(uGroundRoughness, 0.0));
    }
  }

  if (uRoom) {
    hitWall(ro, rd, 0, -3.0, vec3(0.75, 0.16, 0.12), hit);
    hitWall(ro, rd, 0, 3.0, vec3(0.14, 0.3, 0.72), hit);
    hitWall(ro, rd, 2, -3.0, vec3(0.74), hit);
    hitWall(ro, rd, 1, 5.0, vec3(0.74), hit);
  }
  return hit;
}

const float SUN_COS = 0.9962;                         // solskiva dekker en kjegle på rundt fem grader
const float SUN_SOLID_ANGLE = 2.0 * PI * (1.0 - SUN_COS);

/** Himmelen i en gitt retning. Solskiva tas bare med når "withSun" er sann (se trace). */
vec3 sky(vec3 rd, bool withSun) {
  vec3 color = mix(uSkyHorizon, uSkyTop, sqrt(max(rd.y, 0.0)));
  if (withSun && dot(rd, uSunDirection) > SUN_COS) color += uSunColor;
  return color;
}

/** En tilfeldig retning mot et punkt på solskiva. */
vec3 sampleSun() {
  float cosine = 1.0 - rnd() * (1.0 - SUN_COS), sine = sqrt(1.0 - cosine * cosine), angle = 2.0 * PI * rnd();
  vec3 w = uSunDirection;
  vec3 u = normalize(cross(abs(w.y) < 0.99 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0), w));
  return normalize(w * cosine + (u * cos(angle) + cross(w, u) * sin(angle)) * sine);
}

/** Schlicks tilnærming: hvor mye av lyset som speiles i en glassflate, etter innfallsvinkel. */
float reflectance(float cosine, float ratio) {
  float r0 = (1.0 - ratio) / (1.0 + ratio);
  r0 *= r0;
  return r0 + (1.0 - r0) * pow(1.0 - cosine, 5.0);
}

/* ---------- En lysstråle, fulgt baklengs fra kameraet ---------- */
vec3 trace(vec3 ro, vec3 rd) {
  vec3 light = vec3(0.0);        // lyset som er samlet opp
  vec3 throughput = vec3(1.0);   // hvor mye av lyset som slipper gjennom alle sprettene så langt
  bool sharp = true;             // kom strålen hit rett fra kameraet, et speil eller glass?
  bool sunny = dot(uSunColor, vec3(1.0)) > 0.0;

  for (int bounce = 0; bounce < 16; bounce++) {
    if (bounce >= uBounces) break;
    Hit hit = intersect(ro, rd);
    // Sola telles her bare for "skarpe" stråler. Matte flater har allerede fått sollyset sitt
    // direkte (under), og ville ellers fått det to ganger.
    if (hit.t >= FAR) { light += throughput * sky(rd, sharp); break; }

    vec3 p = ro + rd * hit.t;
    vec3 n = hit.normal;

    if (hit.type == LIGHT) { light += throughput * hit.color * hit.param; break; }

    if (hit.type == DIFFUSE) {
      // Matt flate: ny retning trukket med sannsynlighet proporsjonal med cosinus til vinkelen
      // mot normalen. Da faller cosinusleddet i lysligningen bort, og vi står igjen med fargen.
      if (dot(n, rd) > 0.0) n = -n;
      throughput *= hit.color;
      // Direkte sollys: sola er liten, så en tilfeldig sprett treffer den nesten aldri. I stedet
      // sikter vi på den med vilje og sjekker om noe står i veien. Det er dette som gir skygger uten støy.
      if (sunny) {
        vec3 toSun = sampleSun();
        float cosine = dot(n, toSun);
        if (cosine > 0.0 && intersect(p, toSun).t >= FAR) light += throughput * uSunColor * (SUN_SOLID_ANGLE * cosine / PI);
      }
      rd = normalize(n + randomUnitVector() * 0.9999);
      sharp = false;
    } else if (hit.type == METAL) {
      if (dot(n, rd) > 0.0) n = -n;
      rd = normalize(reflect(rd, n) + randomUnitVector() * hit.param);
      if (dot(rd, n) <= 0.0) break; // spredt inn i flaten: absorbert
      throughput *= hit.color;
      sharp = true;
    } else {
      // Glass: lyset enten speiles eller brytes. Fresnel avgjør fordelingen.
      bool entering = dot(rd, n) < 0.0;
      vec3 outward = entering ? n : -n;
      float ratio = entering ? 1.0 / hit.param : hit.param;
      float cosine = min(dot(-rd, outward), 1.0);
      float sine = sqrt(max(0.0, 1.0 - cosine * cosine));
      if (ratio * sine > 1.0 || rnd() < reflectance(cosine, ratio)) rd = reflect(rd, outward);
      else { rd = refract(rd, outward, ratio); throughput *= hit.color; }
      sharp = true;
    }
    ro = p;

    // Russisk rulett: stråler som bærer lite lys avsluttes tilfeldig, og de som overlever
    // forsterkes tilsvarende. Gjennomsnittet blir det samme, men arbeidet mindre.
    if (bounce >= 3) {
      float survive = clamp(max(throughput.r, max(throughput.g, throughput.b)), 0.05, 1.0);
      if (rnd() > survive) break;
      throughput /= survive;
    }
  }
  return light;
}

void main() {
  ivec2 pixel = ivec2(gl_FragCoord.xy);
  rngState = (uint(pixel.x) * 1973u + uint(pixel.y) * 9277u + uint(uSamples) * 26699u) | 1u;
  pcg(); pcg();

  // Tilfeldig punkt inne i pikselen (kantutjevning) og på linsen (dybdeskarphet).
  vec2 uv = ((gl_FragCoord.xy - 0.5 + vec2(rnd(), rnd())) / uResolution * 2.0 - 1.0) * uTanHalfFov;
  uv.x *= uResolution.x / uResolution.y;
  vec3 direction = normalize(uForward + uRight * uv.x + uUp * uv.y);
  vec3 focusPoint = uOrigin + direction * (uFocus / dot(direction, uForward));
  vec2 lens = randomInDisk() * uAperture;
  vec3 origin = uOrigin + uRight * lens.x + uUp * lens.y;

  vec3 color = trace(origin, normalize(focusPoint - origin));
  if (any(isnan(color)) || any(isinf(color))) color = vec3(0.0);
  color = min(color, vec3(12.0)); // demper enkeltstråler som ellers gir lyse prikker som aldri forsvinner

  vec3 previous = texelFetch(uPrevious, pixel, 0).rgb;
  outColor = vec4(mix(previous, color, 1.0 / float(uSamples + 1)), 1.0);
}`;

/**
 * Viser gjennomsnittet på skjermen med eksponering, tonekurve og gammakorreksjon.
 * Tonekurven er Krzysztof Narkowicz sin tilnærming til ACES (2015).
 */
export const DISPLAY = `#version 300 es
precision highp float;
uniform sampler2D uImage;
uniform float uExposure;
out vec4 outColor;
void main() {
  vec3 x = texelFetch(uImage, ivec2(gl_FragCoord.xy), 0).rgb * uExposure;
  vec3 mapped = clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
  outColor = vec4(pow(mapped, vec3(1.0 / 2.2)), 1.0);
}`;
