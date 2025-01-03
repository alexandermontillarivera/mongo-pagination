/**
 * @module mongoosePagination
 * @description A utility for MongoDB pagination with Mongoose that supports filtering, sorting, and global search
 */

import { PipelineStage, Model as MongooseModel, FilterQuery } from "mongoose"

/**
 * Configuration options for pagination
 * @template T - The document type for the collection
 */
export interface PaginationOptions<T> {
	/** Mongoose model to query */
	Model: MongooseModel<T>
	/** Base filter query */
	filter?: FilterQuery<T>
	/** Maximum number of items per page */
	max?: number
	/** Current page number (1-based) */
	page?: number
	/** Enable sorting by createdAt in descending order */
	sort?: boolean
	/** Additional aggregation pipeline stages */
	pipeline?: PipelineStage[]
	/** Fields to extract in the result */
	extract?: { [K in keyof T]?: boolean }
	/** Start date for date range filtering */
	startDate?: string
	/** End date for date range filtering */
	endDate?: string
	/** Use exclusive date range (between dates) instead of inclusive */
	searchBetweenDates?: boolean
	/** Field-specific filters */
	filters?: Partial<Record<keyof T, string>>
	/** Enable global search across all specified filters */
	globalSearch?: boolean
}

/**
 * Pagination result interface
 * @template T - The document type for the collection
 */
interface PaginationResult<T> {
	metadata: {
		total: number
		page: number
		max: number
		next: boolean
		previous: boolean
		totalPages: number
	}
	data: T[]
}

/**
 * Type for date range filter
 */
type DateRangeFilter = {
	createdAt?: {
		$gte?: Date
		$lte?: Date
		$gt?: Date
		$lt?: Date
	}
}

/**
 * Creates a date filter based on provided date range parameters
 * @template T - The document type for the collection
 */
const createDateFilter = (
	startDate?: string,
	endDate?: string,
	searchBetweenDates = false,
): DateRangeFilter => {
	const dateFilter: DateRangeFilter = {}

	if (!startDate && !endDate) return dateFilter

	const dateConfig = {
		start: startDate ? new Date(startDate) : undefined,
		end: endDate ? new Date(endDate) : undefined,
		operators: searchBetweenDates
			? { start: "$gt", end: "$lt" }
			: { start: "$gte", end: "$lte" },
	}

	if (dateConfig.end) {
		const adjustedEndDate = searchBetweenDates
			? dateConfig.end
			: new Date(dateConfig.end.getTime() + 24 * 60 * 60 * 1000)
		dateFilter.createdAt = {
			...dateFilter.createdAt,
			[dateConfig.operators.end]: adjustedEndDate,
		}
	}

	if (dateConfig.start) {
		dateFilter.createdAt = {
			...dateFilter.createdAt,
			[dateConfig.operators.start]: dateConfig.start,
		}
	}

	return dateFilter
}

/**
 * Processes field-specific filters into MongoDB query operators
 * @template T - The document type for the collection
 */
const processFilters = <T extends Record<string, unknown>>(
	filters?: Partial<Record<keyof T, string>>,
): FilterQuery<T> => {
	if (!filters) return {}

	const query: Record<string, unknown> = {}

	Object.entries(filters).forEach(([key, value]) => {
		if (value === undefined) return

		if (value === "true" || value === "false") {
			query[key] = value === "true"
		} else if (!isNaN(Number(value))) {
			query[key] = Number(value)
		} else {
			query[key] = { $regex: value, $options: "i" }
		}
	})

	return query as FilterQuery<T>
}

/**
 * Creates a global search query across all specified filters
 * @template T - The document type for the collection
 */
const createGlobalSearchQuery = <T extends Record<string, unknown>>(
	filters?: Partial<Record<keyof T, string>>,
): FilterQuery<T> => {
	if (!filters) return {}

	const globalConditions = Object.entries(filters)
		.filter(([, value]) => value && typeof value === "string")
		.map(([key, value]) => ({
			[key]: { $regex: value as string, $options: "i" },
		})) as Array<Record<keyof T, { $regex: string; $options: string }>>

	return globalConditions.length
		? ({ $or: globalConditions } as FilterQuery<T>)
		: {}
}

/**
 * Performs paginated queries on MongoDB collections using Mongoose
 * @template T - The document type for the collection
 * @param options - Pagination configuration options
 * @returns Promise with paginated results and metadata
 * @example
 * ```typescript
 * const result = await mongoosePagination({
 *   Model: UserModel,
 *   page: 1,
 *   max: 10,
 *   filters: { name: 'John' },
 *   globalSearch: true
 * });
 * ```
 */
export const mongoosePagination = async <T extends Record<string, unknown>>(
	options: PaginationOptions<T>,
): Promise<PaginationResult<T>> => {
	const {
		Model,
		max = 10,
		page = 1,
		sort = true,
		filter = {},
		pipeline = [],
		extract = {},
		startDate,
		endDate,
		searchBetweenDates = false,
		filters,
		globalSearch = false,
	} = options

	const skip = (page - 1) * max

	// Build combined filter
	const combinedFilter = {
		...filter,
		...createDateFilter(startDate, endDate, searchBetweenDates),
		...(globalSearch
			? createGlobalSearchQuery<T>(filters)
			: processFilters<T>(filters)),
	} as FilterQuery<T>

	// Build aggregation pipeline
	const aggregationPipeline: PipelineStage[] = [
		{ $match: combinedFilter },
		...pipeline,
		{
			$facet: {
				metadata: [{ $count: "total" }],
				data: [
					...(sort ? [{ $sort: { createdAt: -1 } }] : []),
					{ $skip: skip },
					{ $limit: max },
					...(Object.keys(extract).length > 0 ? [{ $project: extract }] : []),
				],
			},
		} as PipelineStage,
		{ $unwind: { path: "$metadata", preserveNullAndEmptyArrays: true } },
	]

	const [result] = await Model.aggregate<{
		metadata?: { total: number }
		data: T[]
	}>(aggregationPipeline)

	const total = result?.metadata?.total ?? 0

	return {
		metadata: {
			total,
			page,
			max,
			next: total > skip + max,
			previous: page > 1,
			totalPages: Math.ceil(total / max),
		},
		data: result?.data ?? [],
	}
}
