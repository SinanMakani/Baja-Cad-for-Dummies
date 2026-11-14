// Tube materials, stock tube profiles and frame-member roles.
// Property values are typical handbook numbers — confirm against your supplier's
// certs and the property values the current Baja SAE rulebook requires.

export const MATERIALS = {
  '4130': { name: '4130 Chromoly (normalized)', E: 29.7e6, Sy: 63100, Su: 97200, density: 0.284, steel: true },
  '1018': { name: '1018 Steel (cold drawn)', E: 29.7e6, Sy: 53700, Su: 63800, density: 0.284, steel: true },
  '1020': { name: '1020 DOM Steel', E: 29.7e6, Sy: 70000, Su: 80000, density: 0.284, steel: true },
  '1026': { name: '1026 DOM Steel', E: 29.7e6, Sy: 70000, Su: 80000, density: 0.284, steel: true },
  '6061': { name: '6061-T6 Aluminum', E: 10.0e6, Sy: 40000, Su: 45000, density: 0.0975, steel: false },
  '7075': { name: '7075-T6 Aluminum', E: 10.4e6, Sy: 73000, Su: 83000, density: 0.101, steel: false },
};

export const DEFAULT_PROFILES = {
  P125x083: { name: '1.250 × 0.083 4130', material: '4130', od: 1.25, wall: 0.083 },
  P125x065: { name: '1.250 × 0.065 4130', material: '4130', od: 1.25, wall: 0.065 },
  P100x120: { name: '1.000 × 0.120 1018 (rule baseline)', material: '1018', od: 1.0, wall: 0.12 },
  P100x095: { name: '1.000 × 0.095 4130', material: '4130', od: 1.0, wall: 0.095 },
  P100x065: { name: '1.000 × 0.065 4130', material: '4130', od: 1.0, wall: 0.065 },
  P100x049: { name: '1.000 × 0.049 4130', material: '4130', od: 1.0, wall: 0.049 },
  P100x035: { name: '1.000 × 0.035 4130', material: '4130', od: 1.0, wall: 0.035 },
  P075x035: { name: '0.750 × 0.035 4130', material: '4130', od: 0.75, wall: 0.035 },
  P0875x058: { name: '0.875 × 0.058 4130 (arm tube)', material: '4130', od: 0.875, wall: 0.058 },
};

export const MEMBER_ROLES = [
  { key: 'RRH', label: 'Rear Roll Hoop', primary: true },
  { key: 'RHO', label: 'Roll Hoop Overhead', primary: true },
  { key: 'FBM', label: 'Front Bracing Member', primary: true },
  { key: 'LFS', label: 'Lower Frame Side', primary: true },
  { key: 'SIM', label: 'Side Impact Member', primary: true },
  { key: 'LC', label: 'Lateral Cross Member', primary: true },
  { key: 'USM', label: 'Under Seat Member', primary: true },
  { key: 'FAB', label: 'Fore-Aft Bracing', primary: false },
  { key: 'LDB', label: 'Lateral Diagonal Bracing', primary: false },
  { key: 'SUSP', label: 'Suspension / mount member', primary: false },
  { key: 'SEC', label: 'Secondary member', primary: false },
];

export const roleInfo = (key) => MEMBER_ROLES.find((r) => r.key === key) || MEMBER_ROLES.at(-1);

export const BAJA_BASELINE = { od: 1.0, wall: 0.12, material: '1018' };
export const MIN_PRIMARY_WALL = 0.062;
export const MIN_SECONDARY = { od: 1.0, wall: 0.035 };

/** Section properties for a round tube (inches). */
export function tubeSection(od, wall) {
  const id = Math.max(0, od - 2 * wall);
  const A = (Math.PI / 4) * (od ** 2 - id ** 2);
  const I = (Math.PI / 64) * (od ** 4 - id ** 4);
  const S = I / (od / 2);
  return { od, id, wall, A, I, S, J: 2 * I };
}

export function profileProps(profile) {
  const mat = MATERIALS[profile.material] || MATERIALS['4130'];
  const sec = tubeSection(profile.od, profile.wall);
  return {
    ...sec,
    mat,
    linearWeight: sec.A * mat.density, // lb per inch
    EI: mat.E * sec.I, // lb·in²
    Mb: mat.Sy * sec.S, // lb·in at first yield
  };
}

/** Baja primary-member check: bending stiffness and strength ≥ 1.0 × 0.120 in 1018 tube. */
export function primaryEquivalency(profile) {
  const cand = profileProps(profile);
  const base = profileProps(BAJA_BASELINE);
  const stiffOk = cand.EI >= base.EI * 0.999;
  const strengthOk = cand.Mb >= base.Mb * 0.999;
  const wallOk = profile.wall >= MIN_PRIMARY_WALL - 1e-9;
  const steel = cand.mat.steel;
  return {
    EI: cand.EI, EIbase: base.EI, Mb: cand.Mb, Mbase: base.Mb,
    stiffRatio: cand.EI / base.EI, strengthRatio: cand.Mb / base.Mb,
    stiffOk, strengthOk, wallOk, steel,
    ok: stiffOk && strengthOk && wallOk && steel,
  };
}

export function secondaryOk(profile) {
  const mat = MATERIALS[profile.material] || {};
  return mat.steel && profile.od >= MIN_SECONDARY.od - 1e-9 && profile.wall >= MIN_SECONDARY.wall - 1e-9;
}
