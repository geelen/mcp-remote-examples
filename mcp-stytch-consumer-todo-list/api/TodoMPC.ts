import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js'
import {z} from 'zod'
import {MCPEntrypoint} from "./lib/MCPEntrypoint.ts";
import {todoService} from "./TodoService.ts";
import {AuthenticationContext} from "../types";

/**
 * The `TodoMPC` class exposes the TODO Service via the Model Context Protocol
 * for consumption by API Agents
 */
export class TodoMPC extends MCPEntrypoint<AuthenticationContext> {
    get todoService() {
        return todoService(this.env, this.props.claims.sub)
    }

    get server() {
        const server = new McpServer({
            name: 'TODO Service',
            version: '1.0.0',
        })

        // TODO: can this be replaced with resources instead?
        server.tool('getTodos', 'Get all TODOs', async () => {
            const todos = await this.todoService.get()

            const notYetDone = todos.filter(todo => !todo.completed)
                .map(todo => `- ` + todo.text + ' id: ' + todo.id)
                .join('\n');
            const done = todos.filter(todo => todo.completed)
                .map(todo => `- ` + todo.text + ' id: ' + todo.id)
                .join('\n');

            const todoList = `TODO:\n${notYetDone}\nDONE:\n${done}`;

            return {
                content: [{type: "text", text: todoList}]
            };
        })

        server.tool('createTodo', 'Add a new TODO task', {todoText: z.string()}, async ({todoText}) => {
            await this.todoService.add(todoText)
            return {
                content: [{type: "text", text: 'TODO added successfully'}]
            };
        })

        server.tool('markTodoComplete', 'Mark a TODO as complete', {todoID: z.string()}, async ({todoID}) => {
            await this.todoService.markCompleted(todoID)
            return {
                content: [{type: "text", text: 'TODO completed successfully'}]
            };
        })

        server.tool('deleteTodo', 'Mark a TODO as deleted', {todoID: z.string()}, async ({todoID}) => {
            await this.todoService.delete(todoID)
            return {
                content: [{type: "text", text: 'TODO deleted successfully'}]
            };
        })

        return server
    }
}