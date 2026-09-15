export const comparativeProductResearchTaskTemplate = `Research @{{result_count}} @{{product_type}} under @{{currency}} @{{max_price}} for @{{use_case}}.

Follow the known comparative product research procedure:
1. Discover candidates.
2. Gather credible manufacturer, product, or review evidence.
3. Enforce the price and use-case constraints.
4. Rank the remaining candidates.
5. Return an evidence-backed shortlist.

Do not purchase anything, log in, or submit forms.

Return JSON only with this shape:
{
  "summary": "string",
  "products": [
    { "name": "string", "price": "string", "url": "https://...", "whySuitable": "string" }
  ],
  "sources": [
    { "url": "https://...", "description": "string" }
  ],
  "limitations": ["string"]
}`;
