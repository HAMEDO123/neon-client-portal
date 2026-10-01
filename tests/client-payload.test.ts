import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { clientPayload } from "../src/lib/client-payload";
import type { FullProject } from "../src/lib/queries";

// The visibility switches are enforced by leaving things out of the answer, not
// by asking the app not to draw them: a client's app runs on a phone the studio
// does not control, and the answer is one `curl` away from anybody holding the
// code. These tests are the only place that is checked.

function project(flags: Partial<FullProject> = {}): FullProject {
  const base = {
    id: "p1",
    token: "t",
    accessCode: "4F7K2QX9",
    name: "Villa",
    clientName: "Al Fulan",
    clientEmail: null,
    clientPhone: null,
    location: null,
    area: null,
    projectType: null,
    description: null,
    coverImageUrl: null,
    deliveryDate: null,
    soldById: null,
    soldOn: null,
    publishState: "PUBLISHED",
    pipelineStatus: "IN_PROGRESS",
    currentStage: "CONCEPT",
    completionPercent: 40,
    showPricing: true,
    showDetailedPricing: true,
    showBoqQuantities: true,
    showBoqPrices: true,
    allowDownloads: true,
    watermarkEnabled: false,
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
    spaces: [],
    drawings: [],
    documents: [],
    boqItems: [
      {
        id: "b1",
        projectId: "p1",
        category: "Joinery",
        name: "Wardrobe",
        description: null,
        specification: null,
        unit: "m2",
        quantity: 4,
        unitPrice: 25,
        imageUrl: null,
        relatedDrawing: null,
        relatedSpace: null,
        notes: null,
        order: 0,
      },
    ],
    pricingItems: [
      { id: "c1", projectId: "p1", category: "Design", label: "Concept", description: null, amount: 1200, isOptional: false, order: 0 },
      { id: "c2", projectId: "p1", category: "Extras", label: "3D film", description: null, amount: 300, isOptional: true, order: 1 },
    ],
    materials: [
      { id: "m1", projectId: "p1", category: "Floor", name: "Oak", brand: null, model: null, color: null, finish: null, specification: null, supplier: null, reference: null, imageUrl: null, estimatedQty: null, price: 80, relatedSpaces: null, order: 0 },
    ],
    furniture: [
      { id: "f1", projectId: "p1", name: "Sofa", brand: null, model: null, dimensions: null, quantity: 1, finish: null, supplier: null, reference: null, imageUrl: null, price: 450, space: null, order: 0 },
    ],
    approvals: [],
    comments: [],
  };

  return { ...base, ...flags } as unknown as FullProject;
}

describe("pricing a client has not been shown", () => {
  it("is absent from the answer, not emptied in it", () => {
    const payload = clientPayload(project({ showPricing: false }));

    assert.equal(payload.pricing, null);
    assert.equal(payload.project.showsPricing, false);
  });

  it("takes every other figure with it, wherever it lives", () => {
    // A material's price and a sofa's price are the costing too. Letting those
    // through would hand over what switching pricing off was keeping back.
    const payload = clientPayload(project({ showPricing: false }));

    assert.equal(payload.materials[0].price, null);
    assert.equal(payload.furniture[0].price, null);
    assert.equal(payload.boq[0].unitPrice, null);
    assert.equal(payload.boq[0].total, null);
  });

  it("is sent in full when it is shown", () => {
    const payload = clientPayload(project());

    assert.equal(payload.pricing?.total, 1200, "the optional line is not in the total");
    assert.equal(payload.pricing?.optionalTotal, 300);
    assert.equal(payload.pricing?.items.length, 2);
    assert.equal(payload.materials[0].price, 80);
    assert.equal(payload.furniture[0].price, 450);
  });

  it("keeps the total when only the line items are held back", () => {
    // The point of showing pricing at all is the figure; showDetailedPricing
    // decides whether the client sees how it is made up.
    const payload = clientPayload(project({ showDetailedPricing: false }));

    assert.equal(payload.pricing?.total, 1200);
    assert.deepEqual(payload.pricing?.items, []);
    assert.equal(payload.pricing?.itemsShown, false);
  });
});

describe("the bill of quantities, which has three switches of its own", () => {
  it("drops the quantity when quantities are off, and keeps the item", () => {
    const payload = clientPayload(project({ showBoqQuantities: false }));

    assert.equal(payload.boq.length, 1, "the client still sees what is specified");
    assert.equal(payload.boq[0].quantity, null);
    assert.equal(payload.boq[0].name, "Wardrobe");
  });

  it("drops the rate and the total when its prices are off", () => {
    const payload = clientPayload(project({ showBoqPrices: false }));

    assert.equal(payload.boq[0].quantity, 4);
    assert.equal(payload.boq[0].unitPrice, null);
    assert.equal(payload.boq[0].total, null);
  });

  it("needs pricing on as well as its own switch", () => {
    // showBoqPrices on with showPricing off must not be a way round it.
    const payload = clientPayload(project({ showPricing: false, showBoqPrices: true }));

    assert.equal(payload.boq[0].unitPrice, null);
    assert.equal(payload.boq[0].total, null);
    assert.equal(payload.project.showsBoqPrices, false);
  });

  it("works the total out rather than trusting one to have been stored", () => {
    const payload = clientPayload(project());
    assert.equal(payload.boq[0].total, 100);
  });
});

describe("what else the answer carries", () => {
  it("says what the app may offer, so it draws no button that would 404", () => {
    assert.equal(clientPayload(project()).project.allowDownloads, true);
    assert.equal(clientPayload(project({ allowDownloads: false })).project.allowDownloads, false);
  });

  it("never carries the project's own credentials", () => {
    // The app has the token already; the code is the studio's to hand out, and
    // an answer that repeated either would put both in anything that logs a
    // response body.
    const payload = JSON.stringify(clientPayload(project()));

    assert.ok(!payload.includes("4F7K2QX9"), "the access code must not be echoed");
    assert.ok(!payload.includes('"token"'), "the token must not be echoed");
  });
});
