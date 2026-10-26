# VvE Renovation Agent-Based Model (ABM)

An agent-based simulation designed to evaluate how access to verified contractor reviews impacts the pace of energy-efficient (EE) building renovations in Dutch Homeowners' Associations (VvEs).

## Research Question

> **Can verified contractor reviews accelerate the rate of completed energy-efficient VvE renovations?**

The simulation runs a comparative side-by-side analysis (With Reviews vs. Without Reviews). Both scenarios use identical initial conditions—same VvEs, same contractor attributes, and identical random seed events—differing strictly in access to verified review data.

---

## Model Setup & Timeframe

* **Time Scale:** 1 tick per 1 day
* **Simulation Period:** 24 simulated years (2026–2050)
* **Population:** 
  * **Contractors:** 80 firms (Capacity: 10 concurrent projects per contractor)
  * **VvEs:** Dynamic population seeking renovations

---

## Key Model Assumptions

> **Note:** Parameters represent operational assumptions for comparative modeling rather than empirically validated values for Dutch VvEs.

### 1. Search & Selection Dynamics
* **Immediate Search:** A ready VvE initiates its first quotation round immediately.
* **Quotation Rounds:** Evaluates up to 3 available firms per round. If preferred firms are at capacity, the VvE proceeds down its preference list.
* **Search Timeout:** A VvE searches for up to **half a year**. If no contractor is selected, it postpones the process for **half a year** before trying again.

### 2. Decision Delay & Acceptance Probabilities

| Parameter | Without Reviews | With Reviews |
| :--- | :--- | :--- |
| **Decision Time** | **31 days** per offer | **14 days** per offer |
| **Acceptance Rate** | Baseline: **10%** | Acceptance = 0.10 + Trust * (Rating - 0.50) |

* *Unrated Contractors:* Contractors with no prior reviews carry no reputation adjustment in the "With Reviews" scenario.

### 3. Satisfaction & Review Generation
* **Contractor Quality:** Base satisfaction probability ranges between **0.68 and 0.95**.
* **Review Submission Rates:** 
  * **20%** of satisfied clients submit a review.
  * **50%** of dissatisfied clients submit a review (simulating negative bias).
* **Renovation Cap:** Each VvE is counted once upon completion and does not undergo further renovation during the simulation run.
