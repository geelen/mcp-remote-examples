import {Hono} from "hono";
import {todoService} from "./TodoService.ts";
import {stytchAuthMiddeware} from "./lib/auth";


/**
 * The Hono app exposes the TODO Service via REST endpoints for consumption by the frontend
 */
export const app = new Hono<{ Bindings: Env }>({strict: false})

    .get('/api/todos', stytchAuthMiddeware, async (c) => {
        const todos = await todoService(c.env, c.var.userID).get()
        return c.json({todos})
    })

    .post('/api/todos', stytchAuthMiddeware, async (c) => {
        const newTodo = await c.req.json<{ todoText: string }>();
        const todos = await todoService(c.env, c.var.userID).add(newTodo.todoText)
        return c.json({todos})
    })

    .post('/api/todos/:id/complete', stytchAuthMiddeware, async (c) => {
        const todos = await todoService(c.env, c.var.userID).markCompleted(c.req.param().id)
        return c.json({todos})
    })

    .delete('/api/todos/:id', stytchAuthMiddeware, async (c) => {
        const todos = await todoService(c.env, c.var.userID).delete(c.req.param().id)
        return c.json({todos})
    })

export type TodoApp = typeof app;