import { NextRequest, NextResponse } from "next/server";

import { getProductsPage } from "@/lib/products/product-repository";
import {
  isAuthorizedService,
  unauthorizedResponse,
} from "@/lib/service-auth";

import type { Gender, Market, ProductSort } from "@/types/product";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isMarket(value: string | null): value is Market {
  return value === "US" || value === "KR";
}

function isGender(value: string | null): value is Exclude<Gender, "UNISEX"> {
  return value === "MEN" || value === "WOMEN";
}

function isSort(value: string | null): value is ProductSort {
  return (
    value === "discount-desc" ||
    value === "price-asc" ||
    value === "price-desc" ||
    value === "newest"
  );
}

function parsePositiveInteger(value: string | null, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);

  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export async function GET(request: NextRequest) {
  try {
    if (!isAuthorizedService(request)) {
      return unauthorizedResponse();
    }

    const parameters = request.nextUrl.searchParams;

    const marketValue = parameters.get("market");

    const genderValue = parameters.get("gender");

    const sortValue = parameters.get("sort");

    const market: Market = isMarket(marketValue) ? marketValue : "US";

    const gender: Exclude<Gender, "UNISEX"> = isGender(genderValue)
      ? genderValue
      : "MEN";

    const sort: ProductSort = isSort(sortValue) ? sortValue : "discount-desc";

    const page = parsePositiveInteger(parameters.get("page"), 1);

    const size = Math.min(
      300,
      parsePositiveInteger(parameters.get("size"), 60),
    );

    const brandSlugs = parameters.getAll("brand").filter(Boolean);

    const categorySlug = parameters.get("category");

    const result = await getProductsPage({
      market,
      gender,
      page,
      size,
      sort,
      brandSlugs: brandSlugs as Parameters<
        typeof getProductsPage
      >[0]["brandSlugs"],
      categorySlug:
        categorySlug && categorySlug !== "all"
          ? (categorySlug as Parameters<
              typeof getProductsPage
            >[0]["categorySlug"])
          : null,
    });

    return NextResponse.json(result, {
      headers: {
        "Cache-Control": "public, s-maxage=300, stale-while-revalidate=900",
      },
    });
  } catch (error) {
    console.error("Product catalog read failed:", error);

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to load product catalog.",
      },
      {
        status: 500,
      },
    );
  }
}
