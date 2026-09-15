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

export const githubRepositoryResearchTaskTemplate = `On GitHub, find @{{result_count}} public repositories related to @{{query}} with at least @{{min_stars}} stars.

For each repository, return:
- name
- owner
- stars as an integer
- GitHub URL
- short description

Do not log in.
Return JSON only in this shape:
{
  "repositories": [
    {
      "name": "string",
      "owner": "string",
      "stars": 1000,
      "url": "https://github.com/owner/repository",
      "description": "string"
    }
  ]
}`;
