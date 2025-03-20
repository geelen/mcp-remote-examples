import {Todo} from "../types";

/**
 * The `TodoService` class provides methods for managing a to-do list backed by Cloudflare KV storage.
 * This includes operations such as retrieving todos, adding new todos,
 * deleting existing todos, and marking todos as completed.
 */
class TodoService {
    constructor(
        private env: Env,
        private userID: string,
    ) {
    }

    get = async (): Promise<Todo[]> => {
        const todos = await this.env.TODOS.get<Todo[]>(this.userID, "json")
        return todos || [];
    }

    #set = async (todos: Todo[]): Promise<Todo[]> => {
        await this.env.TODOS.put(this.userID, JSON.stringify(todos))
        return todos
    }

    add = async (todoText: string): Promise<Todo[]> => {
        const todos = await this.get()
        const newTodo: Todo = {
            id: Date.now().toString(),
            text: todoText,
            completed: false
        }
        todos.push(newTodo)
        return this.#set(todos)
    }

    delete = async (todoID: string): Promise<Todo[]> => {
        const todos = await this.get()
        const cleaned = todos.filter(t => t.id !== todoID);
        return this.#set(cleaned);
    }

    markCompleted = async (todoID: string): Promise<Todo[]> => {
        const todos = await this.get()
        const completedTodo = todos.find(t => t.id === todoID);
        if (completedTodo) {
            completedTodo.completed = true;
            return this.#set(todos);
        }
        return todos;
    }
}

export const todoService = (env: Env, userID: string) => new TodoService(env, userID)