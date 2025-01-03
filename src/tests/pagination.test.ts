import assert from "node:assert"
import mongoose from "mongoose"
import { describe, it, before, after } from "node:test"
import { Schema, InferSchemaType } from "mongoose"
import { mongoosePagination } from "../lib/mongoosePagination"

const taskSchema = new Schema({
	title: { type: String, required: true },
	description: String,
	completed: { type: Boolean, default: false },
	priority: {
		type: String,
		enum: ["low", "medium", "high"],
		default: "medium",
	},
	dueDate: Date,
	createdAt: { type: Date, default: Date.now },
	updatedAt: { type: Date, default: Date.now },
	tags: [String],
})

type Task = InferSchemaType<typeof taskSchema>
const TaskModel = mongoose.model<Task>("Task", taskSchema)

const sampleTasks = [
	{
		title: "Complete report",
		description: "Finish the monthly report",
		completed: false,
		priority: "high",
		dueDate: new Date("2024-02-01"),
		tags: ["work"],
	},
	{
		title: "Meeting",
		description: "Attend the weekly meeting",
		completed: true,
		priority: "medium",
		dueDate: new Date("2024-01-15"),
		tags: ["work"],
	},
	{
		title: "Shopping",
		description: "Go to the supermarket",
		completed: false,
		priority: "low",
		dueDate: new Date("2024-01-20"),
		tags: ["personal"],
	},
	...Array(10)
		.fill(null)
		.map((_, i) => ({
			title: `Task ${i + 4}`,
			description: `Task description ${i + 4}`,
			completed: i % 2 === 0,
			priority: ["low", "medium", "high"][i % 3],
			dueDate: new Date(2024, 0, i + 1),
			tags: [`tag${i}`],
		})),
]

describe("Mongoose Pagination Tests", async () => {
	before(async () => {
		const mongoUrl = "mongodb://localhost:27017/task_test_db"
		await mongoose.connect(mongoUrl)
		await TaskModel.deleteMany({})
		await TaskModel.insertMany(sampleTasks)
	})

	after(async () => {
		await TaskModel.deleteMany({})
		await mongoose.connection.close()
	})

	it("should retrieve paginated results with default options", async () => {
		const result = await mongoosePagination({
			Model: TaskModel,
		})

		assert.equal(result.metadata.page, 1)
		assert.equal(result.metadata.max, 10)
		assert.ok(Array.isArray(result.data))
		assert.equal(result.data.length, 10)
	})

	it("should apply custom page size and pagination", async () => {
		const result = await mongoosePagination({
			Model: TaskModel,
			page: 2,
			max: 5,
		})

		assert.equal(result.metadata.page, 2)
		assert.equal(result.metadata.max, 5)
		assert.ok(result.data.length <= 5)
	})

	it("should filter by completed status", async () => {
		const result = await mongoosePagination({
			Model: TaskModel,
			filters: { completed: "false" },
		})

		assert.ok(result.data.every((task) => task.completed === false))
	})

	it("should apply date range filters", async () => {
		const result = await mongoosePagination({
			Model: TaskModel,
			startDate: "2024-01-15",
			endDate: "2024-01-20",
		})

		assert.ok(
			result.data.every((task) => {
				const taskDate = new Date(task.createdAt)
				return (
					taskDate >= new Date("2024-01-15") &&
					taskDate <= new Date("2024-01-20")
				)
			}),
		)
	})

	it("should perform global search across fields", async () => {
		const result = await mongoosePagination({
			Model: TaskModel,
			filters: { title: "meeting" },
			globalSearch: true,
		})

		assert.ok(
			result.data.some(
				(task) =>
					task.title.toLowerCase().includes("meeting") ||
					task.description?.toLowerCase().includes("meeting"),
			),
		)
	})

	it("should sort by creation date in descending order", async () => {
		const result = await mongoosePagination({
			Model: TaskModel,
			sort: true,
		})

		const dates = result.data.map((task) => new Date(task.createdAt).getTime())
		const isSorted = dates.every((date, i) => i === 0 || date <= dates[i - 1])
		assert.ok(isSorted)
	})

	it("should extract specific fields only", async () => {
		const result = await mongoosePagination({
			Model: TaskModel,
			extract: { title: true, completed: true },
		})

		assert.ok(
			result.data.every((task) => {
				const keys = Object.keys(task)
				return (
					keys.includes("title") &&
					keys.includes("completed") &&
					!keys.includes("description")
				)
			}),
		)
	})

	it("should handle empty results", async () => {
		const result = await mongoosePagination({
			Model: TaskModel,
			filter: { title: "NonexistentTask" },
		})

		assert.equal(result.data.length, 0)
		assert.equal(result.metadata.total, 0)
		assert.equal(result.metadata.totalPages, 0)
	})

	it("should filter by priority", async () => {
		const result = await mongoosePagination({
			Model: TaskModel,
			filters: { priority: "high" },
		})

		assert.ok(result.data.every((task) => task.priority === "high"))
	})

	it("should handle multiple filters", async () => {
		const result = await mongoosePagination({
			Model: TaskModel,
			filters: {
				priority: "high",
				completed: "false",
			},
		})

		assert.ok(
			result.data.every(
				(task) => task.priority === "high" && task.completed === false,
			),
		)
	})

	it("should calculate correct metadata", async () => {
		const totalTasks = await TaskModel.countDocuments()
		const result = await mongoosePagination({
			Model: TaskModel,
			max: 5,
		})

		assert.equal(result.metadata.totalPages, Math.ceil(totalTasks / 5))
		assert.equal(result.metadata.next, totalTasks > 5)
		assert.equal(result.metadata.previous, false)
	})

	it("should throw an error for invalid page values", async () => {
		const values = [0, -1, NaN]
		await assert.rejects(
			mongoosePagination({
				Model: TaskModel,
				page: values[Math.floor(Math.random() * values.length)],
			}),
			{ name: "ErrorInvalidPage" },
		)
	})

	it("should throw an error for invalid max values", async () => {
		const values = [0, -1, NaN]
		await assert.rejects(
			mongoosePagination({
				Model: TaskModel,
				max: values[Math.floor(Math.random() * values.length)],
			}),
			{ name: "ErrorInvalidMax" },
		)
	})

	it("should handle invalid date ranges", async () => {
		const result = await mongoosePagination({
			Model: TaskModel,
			startDate: "InvalidDate",
			endDate: "InvalidDate",
		})

		assert.equal(result.data.length, 0)
	})

	it("should handle invalid filters", async () => {
		const result = await mongoosePagination({
			Model: TaskModel,
			filters: { invalidFilter: "invalidValue" },
		})

		assert.equal(result.data.length, 0)
	})

	it("should handle invalid global search", async () => {
		const result = await mongoosePagination({
			Model: TaskModel,
			filters: { invalidFilter: "invalidValue" },
			globalSearch: true,
		})

		assert.equal(result.data.length, 0)
	})

	it("should handle invalid sort options", async () => {
		const result = await mongoosePagination({
			Model: TaskModel,
			sort: true,
			filters: { invalidFilter: "invalidValue" },
		})

		assert.equal(result.data.length, 0)
	})
})
