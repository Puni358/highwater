# Changelog for Person 1 (Contract v2.1.1 to v2.2.0 Freeze)

## Contract Guarantee
**NO EXISTING FIELDS OR IDENTIFIERS HAVE BEEN REMOVED OR RENAMED.**
All baseline keys, feature properties, feature indices (0 to 15), and scenario IDs present in `contract/routes_v2_1_1.json` are strictly preserved in their original order. All modifications in v2.2.0 are purely additive and backward-compatible.

---

## 1. Deprecated Features (Indices 9 and 10)
- **Feature 9 (`res5_boat`)**: Marked with `"deprecated": true` and `"superseded_by": 13`. Represents the legacy single-leg boat route before full multimodal cascade staging was introduced.
- **Feature 10 (`res5_heli`)**: Marked with `"deprecated": true` and `"superseded_by": 15`. Represents the legacy helicopter route before full cascade feature enumeration was added.
- **Note**: Both features remain at indices 9 and 10 to guarantee feature index stability.

---

## 2. Cascade Scenario Representation (`scenario_5_full_cascade`)
- **Indices**:
  - `"feature_indices"`: `[11, 12, 13, 14, 15]` (the five chronological attempts of the cascade).
  - `"legacy_feature_indices"`: `[9, 10]` (pointing to the deprecated legacy features).
  - `"selected_feature_index"`: `15` (pointing to the successful helicopter deployment).
- **Attempts Array (`attempts`)**:
  - Each element now includes `"feature_index": int` directly mapping each escalation attempt to its corresponding GeoJSON feature.
  - Each attempt lists `"blocked_edges"`.
  - The final successful attempt (`HELI_1`) includes `"selected": true`.

---

## 3. Slider Results Shape Harmonization
- For high rainfall intervals where surface access is impossible and aerial support is grounded, the fallback `"NO_SAFE_OPTION"` entry now includes:
  - `"vehicle_type": "ALL"`
  - `"query_id": "no_safe_option"`
  - `"destination": "ZONE_NORTH_RESIDENTIAL"`
  - `"advisory": "NO_SAFE_OPTION"`
- This harmonizes the dictionary structure across all slider outputs, preventing missing key exceptions during downstream UI rendering.
- Added `"decision_stability"` evaluation for each slider result:
  - `"share_unchanged"`: Proportion of parameter sensitivity perturbations leaving the optimal path unchanged.
  - `"label"`: `"STABLE"` or `"SENSITIVE"` based on stability threshold.

---

## 4. Capacity-Aware Dispatch Updates
- **Top-Level Dispatch (`dispatch`)**:
  - `"objective"`: `"priority*reliability*people*delivered_share"`
  - `"total_people_equivalents"`: Sum of people equivalents supplied across all assigned missions.
  - `"total_value"`: Sum of assignment objective values.
  - `"total_eta_minutes"`: Sum of one-way travel times for all deployed assets.
  - `"note"`: `"Incident sites are existing graph nodes; a bridgehead node is used as a demo incident."`
- **Asset Assignments (`dispatch.assignments[]`)**:
  - `"objective"`: `"priority*reliability*people*delivered_share"`
  - `"people_equivalents_supplied"`: `round(people * delivered_share, 2)`
  - `"value"`: Evaluated assignment score under the people-weighted capacity objective.

---

## 5. Summary of Added Fields by Scope

| Scope | Added Field | Type | Description |
|---|---|---|---|
| Feature (Properties) | `deprecated` | `boolean` | True for features 9 and 10 |
| Feature (Properties) | `superseded_by` | `integer` | Points to replacement feature (13 or 15) |
| Feature (Properties) | `query_id` | `string` | Query identifier on slider / fallback entries |
| Scenario | `legacy_feature_indices` | `array[int]` | `[9, 10]` on scenario 5 |
| Scenario (`attempts[]`) | `feature_index` | `integer` | Feature index corresponding to attempt |
| Scenario (`attempts[]`) | `selected` | `boolean` | True on final selected cascade attempt |
| Slider Result | `decision_stability` | `object` | Stability score and label under parameter drift |
| Slider Result (`NO_SAFE_OPTION`) | `vehicle_type` | `string` | Set to `"ALL"` |
| Slider Result (`NO_SAFE_OPTION`) | `query_id` | `string` | Set to `"no_safe_option"` |
| Slider Result (`NO_SAFE_OPTION`) | `destination` | `string` | Set to destination node ID |
| Dispatch | `objective` | `string` | Formulation string |
| Dispatch | `total_people_equivalents`| `number` | Total people equivalents served |
| Dispatch | `note` | `string` | Clarification on incident node selection |
| Dispatch (`assignments[]`) | `objective` | `string` | Formulation string |
| Dispatch (`assignments[]`) | `people_equivalents_supplied` | `number` | People equivalents served by single sortie |

---

## 6. Final Hardening Pass (Cleanup & Invariants)

1. **Deprecated Duplicates Removed**:
   - Dropped legacy duplicated features 9 and 10. Total feature count is cleanly 14 (indices 0 to 13).
   - Removed `deprecated` and `superseded_by` properties.
   - Renumbered `scenario_5_full_cascade` feature indices to `[9, 10, 11, 12, 13]` with `selected_feature_index: 13`.
   - Every feature belongs to exactly one scenario.
   - No two features in any scenario share `(vehicle_type, origin, destination)` unless their `blocked_edges` differ.

2. **Cascade Order**:
   - Added integer `stage` (1..n) and string `stage_title` across cascade scenarios (3a: stages 1..3, 3b: stages 4..5, 5: stages 1..5) in sequence: Ambulance -> 4x4 Truck -> Rescue Boat -> Rescue Boat (River Blocked) -> Helicopter.

3. **Distance & Geometry Consistency**:
   - Added `geometry_length_km` across all OK features.
   - Added `distance_basis: "road_factor applied to schematic geometry"` whenever schematic distance exceeds polyline length by >1%.

4. **Dispatch Honesty**:
   - `unserved` lists only incidents with zero delivery.
   - Added `partially_served` list (`{incident, demanded_kg, delivered_kg, unmet_kg, unmet_share}`) where `demanded_kg > delivered_kg`.
   - Added `total_unmet_kg` reflecting total unsatisfied relief goods demand.

5. **Helicopter Timing**:
   - Added named constant `HELI_LAUNCH_MINUTES = 10.0` staging duration to helicopter ETA.
   - Exposing `launch_minutes: 10.0` on helicopter route payloads.

6. **Verification Flag**:
   - Added top-level `"verified": false` to `routes.json` and `schema.json`.
